import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { DreLinha, DreResposta } from "@/lib/types";

export const runtime = "nodejs";

const EMPRESA_ID = 1;

function segmentos(codigo: string): number[] {
  return codigo.split(".").map(Number);
}

function comparaCodigos(a: string, b: string): number {
  const sa = segmentos(a);
  const sb = segmentos(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const da = sa[i] ?? -1;
    const db = sb[i] ?? -1;
    if (da !== db) return da - db;
  }
  return 0;
}

function pai(codigo: string): string | null {
  const i = codigo.lastIndexOf(".");
  return i > 0 ? codigo.slice(0, i) : null;
}

/** Pagina uma consulta (PostgREST limita a 1000 linhas por página). */
async function buscarTudo<T>(
  monta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const PAGINA = 1000;
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await monta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = data ?? [];
    tudo.push(...lote);
    if (lote.length < PAGINA) return tudo;
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get("ano") ?? new Date().getFullYear());
  const versaoParam = searchParams.get("versao");
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) {
    return NextResponse.json({ error: "Ano inválido" }, { status: 400 });
  }
  // Filtro opcional por unidade (usado pela Análise de custos). Como o orçamento
  // não tem dimensão de unidade, com o filtro ligado só o realizado faz sentido.
  const unidadeParam = searchParams.get("unidade");
  let unidade: number | null = null;
  if (unidadeParam !== null && unidadeParam !== "") {
    unidade = Number(unidadeParam);
    if (!Number.isInteger(unidade)) {
      return NextResponse.json({ error: "Unidade inválida" }, { status: 400 });
    }
  }

  let planoData: { codigo: string; nome: string; nivel: number; natureza: number; exibir_dre: boolean }[];
  let deParaData: { cd_classificacao_erp: string; codigo_gerencial: string }[];
  // Realizado vem PIVOTADO (1 linha por classificação, 12 meses num array): ~368
  // linhas, cabe numa única resposta (limite de 1000) sem re-executar a função.
  let realizadoData: { cd_classificacao_erp: string; ds_conta_erp: string; valores: (number | string)[] }[];
  try {
    const [planoTmp, deParaTmp, realizadoRes] = await Promise.all([
      buscarTudo((de, ate) =>
        supabase
          .from("plano_contas")
          .select("codigo, nome, nivel, natureza, exibir_dre")
          .eq("empresa_id", EMPRESA_ID)
          .order("codigo")
          .range(de, ate)
      ),
      buscarTudo((de, ate) =>
        supabase
          .from("de_para_contas")
          .select("cd_classificacao_erp, codigo_gerencial")
          .eq("empresa_id", EMPRESA_ID)
          .order("cd_classificacao_erp")
          .range(de, ate)
      ),
      unidade === null
        ? supabase.rpc("dre_realizado_pivot", { p_empresa: EMPRESA_ID, p_ano: ano })
        : supabase.rpc("dre_realizado_pivot_unidade", { p_empresa: EMPRESA_ID, p_ano: ano, p_filial: unidade }),
    ]);
    if (realizadoRes.error) throw new Error(realizadoRes.error.message);
    planoData = planoTmp;
    deParaData = deParaTmp;
    realizadoData = (realizadoRes.data ?? []) as typeof realizadoData;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  // Versão do orçamento: a informada, ou a ativa mais recente do ano
  let versaoId: string | null = null;
  let versaoNome: string | null = null;
  if (unidade !== null) {
    // Sem orçamento por unidade: o planejado fica zerado em vez de repetir o
    // valor da empresa inteira ao lado do realizado de uma filial só.
  } else if (versaoParam) {
    versaoId = versaoParam;
    const { data } = await supabase.from("orcamento_versoes").select("nome").eq("id", versaoParam).single();
    versaoNome = data?.nome ?? null;
  } else {
    const { data } = await supabase
      .from("orcamento_versoes")
      .select("id, nome")
      .eq("empresa_id", EMPRESA_ID)
      .eq("ano", ano)
      .eq("ativa", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      versaoId = data[0].id;
      versaoNome = data[0].nome;
    }
  }

  let orcamento: { codigo_gerencial: string; mes: number; valor: number }[] = [];
  if (versaoId) {
    const vid = versaoId;
    try {
      orcamento = await buscarTudo((de, ate) =>
        supabase
          .from("orcamento_valores")
          .select("codigo_gerencial, mes, valor")
          .eq("versao_id", vid)
          .order("codigo_gerencial")
          .range(de, ate)
      );
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  const plano = planoData.filter((p) => p.exibir_dre);
  const codigosPlano = new Set(plano.map((p) => p.codigo));
  const dePara = new Map(deParaData.map((d) => [d.cd_classificacao_erp, d.codigo_gerencial]));

  // Valores diretos por conta gerencial (antes do roll-up)
  const realizadoDireto = new Map<string, number[]>();
  const planejadoDireto = new Map<string, number[]>();
  const zeros = () => Array(12).fill(0) as number[];

  const naoMapeadoAgg = new Map<string, { ds: string; total: number }>();
  for (const r of realizadoData) {
    const codigo = dePara.get(r.cd_classificacao_erp);
    if (codigo && codigosPlano.has(codigo)) {
      if (!realizadoDireto.has(codigo)) realizadoDireto.set(codigo, zeros());
      const arr = realizadoDireto.get(codigo)!;
      for (let m = 0; m < 12; m++) arr[m] += Number(r.valores[m] ?? 0);
    } else {
      const total = r.valores.reduce((a: number, v) => a + Number(v ?? 0), 0);
      const atual = naoMapeadoAgg.get(r.cd_classificacao_erp) ?? { ds: r.ds_conta_erp, total: 0 };
      atual.total += total;
      naoMapeadoAgg.set(r.cd_classificacao_erp, atual);
    }
  }

  for (const o of orcamento) {
    if (!codigosPlano.has(o.codigo_gerencial)) continue;
    if (!planejadoDireto.has(o.codigo_gerencial)) planejadoDireto.set(o.codigo_gerencial, zeros());
    planejadoDireto.get(o.codigo_gerencial)![o.mes - 1] += Number(o.valor);
  }

  // Roll-up: total do nó = valor direto + soma dos filhos (mais fundo primeiro)
  const ordenadoProfundo = [...plano].sort((a, b) => b.nivel - a.nivel);
  const realizadoTotal = new Map<string, number[]>();
  const planejadoTotal = new Map<string, number[]>();
  const temFilhos = new Map<string, boolean>();

  for (const p of ordenadoProfundo) {
    const r = [...(realizadoDireto.get(p.codigo) ?? zeros())];
    const pl = [...(planejadoDireto.get(p.codigo) ?? zeros())];
    // filhos já processados (nível maior)
    for (const [cod, valores] of realizadoTotal) {
      if (pai(cod) === p.codigo) for (let m = 0; m < 12; m++) r[m] += valores[m];
    }
    for (const [cod, valores] of planejadoTotal) {
      if (pai(cod) === p.codigo) for (let m = 0; m < 12; m++) pl[m] += valores[m];
    }
    temFilhos.set(p.codigo, plano.some((f) => pai(f.codigo) === p.codigo));
    realizadoTotal.set(p.codigo, r);
    planejadoTotal.set(p.codigo, pl);
  }

  const linhas: DreLinha[] = [...plano]
    .sort((a, b) => comparaCodigos(a.codigo, b.codigo))
    .map((p) => ({
      codigo: p.codigo,
      nome: p.nome,
      nivel: p.nivel,
      natureza: p.natureza,
      realizado: realizadoTotal.get(p.codigo) ?? zeros(),
      planejado: planejadoTotal.get(p.codigo) ?? zeros(),
      temFilhos: temFilhos.get(p.codigo) ?? false,
    }));

  const resposta: DreResposta = {
    ano,
    versaoId,
    versaoNome,
    linhas,
    naoMapeado: [...naoMapeadoAgg.entries()]
      .map(([cd, v]) => ({ cd_classificacao_erp: cd, ds_conta_erp: v.ds, total: v.total }))
      .sort((a, b) => a.cd_classificacao_erp.localeCompare(b.cd_classificacao_erp)),
  };

  return NextResponse.json(resposta);
}
