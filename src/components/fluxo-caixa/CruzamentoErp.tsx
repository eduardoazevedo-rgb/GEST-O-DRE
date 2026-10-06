"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  formatGrade, formatReais, listarMeses, mesDe, rotuloMes, somarMeses,
  type Bloco, type Lancamento, type Premissa,
} from "@/lib/fluxo-caixa";

// As linhas são os mesmos blocos do fluxo próprio; o lado do sistema vem do que
// está vinculado — fornecedor apontado na linha do lançamento ou na tabela de
// vínculos. O que ninguém reclamou cai em "sem vínculo".
const AZUL = "#0000C2";
const AZUL_ALT = "#1A1AD1";
const TOLERANCIA = 0.05; // ±5%: dentro disso a previsão é considerada aderente
const POR_PAGINA = 50;
const SEM_VINCULO = "__sem_vinculo__";
const REGRAS = "__regras__";

// Grupos em que o ERP se divide (regra em fc_erp_base).
const GRUPOS_ERP: { id: string; rotulo: string }[] = [
  { id: "recebimentos", rotulo: "Recebimento de títulos de venda (clientes, cartão, cheque)" },
  { id: "fornecedores", rotulo: "Contas a pagar em geral" },
  { id: "estrategicos", rotulo: "Fornecedores com código no ERP (matérias-primas)" },
  { id: "creditos", rotulo: "Créditos concedidos por esses fornecedores" },
  { id: "financiamentos", rotulo: "Empréstimos e consórcios" },
  { id: "investimentos", rotulo: "Contas a pagar – imobilizado" },
];

interface LinhaErp { mes: string; grupo: string; situacao: "realizado" | "aberto"; valor: number }
interface PessoaErp { cd_pessoa: number; nome: string; valores: Map<string, number> }
interface Solta { cd_pessoa: number; nome: string; grupo: string; valores: Map<string, number> }

interface Props {
  empresaId: number;
  blocos: Bloco[];
  lancamentos: Lancamento[];
  premissas: Premissa[];
}

const mesAtual = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`; };
const paraMapa = (o: unknown) => new Map(Object.entries((o ?? {}) as Record<string, number | string>).map(([k, v]) => [k, Number(v)]));
const somaMapas = (ms: (Map<string, number> | undefined)[]) => {
  const out = new Map<string, number>();
  for (const m of ms) m?.forEach((v, k) => out.set(k, (out.get(k) ?? 0) + v));
  return out;
};
const recuo = (nivel: number) => 12 + nivel * 24;

export default function CruzamentoErp({ empresaId, blocos, lancamentos, premissas }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const hoje = mesAtual();
  const inicioAno = `${hoje.slice(0, 4)}-01-01`;
  const opcoes = listarMeses("2025-01-01", somarMeses(hoje, 24));

  const [de, setDe] = useState(inicioAno);
  const [ate, setAte] = useState(somarMeses(inicioAno, 11));
  const [milhares, setMilhares] = useState(true);
  const [erp, setErp] = useState<LinhaErp[]>([]);
  const [vinculos, setVinculos] = useState<Map<number, string>>(new Map());
  const [regras, setRegras] = useState<Map<string, string>>(new Map()); // grupo do ERP → bloco
  const [ligadoGrupo, setLigadoGrupo] = useState<Map<string, number>>(new Map()); // grupo|mês já contado por pessoa
  const [pessoas, setPessoas] = useState<Map<number, PessoaErp>>(new Map());
  const [soltas, setSoltas] = useState<{ linhas: Solta[]; total: number; carregando: boolean }>({ linhas: [], total: 0, carregando: false });
  const [sincronizado, setSincronizado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  // A seção das regras já começa aberta: é o atalho para ligar grupo inteiro.
  const [abertos, setAbertos] = useState<Set<string>>(new Set([REGRAS]));
  const [versao, setVersao] = useState(0); // sobe a cada vínculo criado ou desfeito

  const meses = useMemo(() => (de <= ate ? listarMeses(de, ate) : []), [de, ate]);

  // Fornecedores já ligados a algum bloco: pelo vínculo ou pela linha do previsto.
  const pessoasLigadas = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of lancamentos) {
      if (l.status === "cancelado") continue;
      if (l.cd_pessoa != null && !m.has(l.cd_pessoa)) m.set(l.cd_pessoa, l.bloco_id);
      // os códigos digitados em "Códigos no ERP" valem como vínculo do bloco
      for (const parte of (l.codigos_erp ?? "").split(/[^0-9]+/)) {
        const cd = Number(parte);
        if (parte && Number.isFinite(cd) && !m.has(cd)) m.set(cd, l.bloco_id);
      }
    }
    for (const [cd, bloco] of vinculos) m.set(cd, bloco); // o vínculo explícito manda
    return m;
  }, [lancamentos, vinculos]);

  useEffect(() => {
    if (empresaId !== 1 || meses.length === 0) { setCarregando(false); return; }
    let vivo = true;
    (async () => {
      setCarregando(true); setErro("");
      const [grade, vinc, regra, sinc] = await Promise.all([
        supabase.rpc("fc_cruzamento_erp", { p_empresa: empresaId, p_de: de, p_ate: ate }),
        supabase.from("fc_erp_vinculos").select("cd_pessoa, bloco_id").eq("empresa_id", empresaId),
        supabase.from("fc_erp_vinculos_grupo").select("grupo, bloco_id").eq("empresa_id", empresaId),
        supabase.from("fc_erp_titulos_resumo").select("sincronizado_em").eq("empresa_id", empresaId)
          .order("sincronizado_em", { ascending: false }).limit(1),
      ]);
      if (!vivo) return;
      const falha = grade.error ?? vinc.error ?? regra.error ?? sinc.error;
      if (falha) { setErro(falha.message); setCarregando(false); return; }
      setErp(((grade.data ?? []) as { mes: string; grupo: string; situacao: LinhaErp["situacao"]; valor: number | string }[])
        .map((r) => ({ mes: r.mes.slice(0, 10), grupo: r.grupo, situacao: r.situacao, valor: Number(r.valor) })));
      setVinculos(new Map(((vinc.data ?? []) as { cd_pessoa: number; bloco_id: string }[]).map((v) => [Number(v.cd_pessoa), v.bloco_id])));
      setRegras(new Map(((regra.data ?? []) as { grupo: string; bloco_id: string }[]).map((r) => [r.grupo, r.bloco_id])));
      setSincronizado((sinc.data?.[0] as { sincronizado_em?: string } | undefined)?.sincronizado_em ?? null);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [supabase, empresaId, de, ate, versao, meses.length]);

  // Movimento no ERP de quem está ligado a um bloco.
  useEffect(() => {
    const alvo = [...pessoasLigadas.keys()];
    if (empresaId !== 1 || alvo.length === 0 || meses.length === 0) { setPessoas(new Map()); setLigadoGrupo(new Map()); return; }
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc("fc_erp_grupo_pessoas", {
        p_empresa: empresaId, p_de: de, p_ate: ate, p_grupo: null, p_busca: null,
        p_limite: 2000, p_offset: 0, p_pessoas: alvo,
      });
      if (!vivo) return;
      if (error) { setErro(error.message); return; }
      // A mesma pessoa pode aparecer em mais de um grupo/lado: junta tudo.
      const m = new Map<number, PessoaErp>();
      const porGrupo = new Map<string, number>();
      for (const x of (data ?? []) as Record<string, unknown>[]) {
        const cd = Number(x.cd_pessoa);
        const atual = m.get(cd);
        const valores = paraMapa(x.valores);
        if (atual) atual.valores = somaMapas([atual.valores, valores]);
        else m.set(cd, { cd_pessoa: cd, nome: String(x.nome), valores });
        valores.forEach((v, mes) => {
          const k = `${String(x.grupo)}|${mes}`;
          porGrupo.set(k, (porGrupo.get(k) ?? 0) + v);
        });
      }
      setPessoas(m);
      setLigadoGrupo(porGrupo);
    })();
    return () => { vivo = false; };
  }, [supabase, empresaId, de, ate, pessoasLigadas, meses.length]);

  const carregarSoltas = useCallback(async (offset: number) => {
    setSoltas((s) => ({ ...s, carregando: true }));
    const { data, error } = await supabase.rpc("fc_erp_nao_vinculados", {
      p_empresa: empresaId, p_de: de, p_ate: ate, p_limite: POR_PAGINA, p_offset: offset,
    });
    if (error) { setErro(error.message); setSoltas((s) => ({ ...s, carregando: false })); return; }
    const linhas = (data ?? []) as Record<string, unknown>[];
    const novas = linhas.map((x) => ({
      cd_pessoa: Number(x.cd_pessoa), nome: String(x.nome), grupo: String(x.grupo), valores: paraMapa(x.valores),
    }));
    setSoltas((s) => ({
      linhas: offset === 0 ? novas : [...s.linhas, ...novas],
      total: linhas[0] ? Number(linhas[0].total_pessoas) : (offset === 0 ? 0 : s.total),
      carregando: false,
    }));
  }, [supabase, empresaId, de, ate]);

  const carregarTodas = useCallback(async () => {
    setSoltas((s) => ({ ...s, carregando: true }));
    let pagina = 0;
    const todas: Solta[] = [];
    let total = 0;
    for (;;) {
      const { data, error } = await supabase.rpc("fc_erp_nao_vinculados", {
        p_empresa: empresaId, p_de: de, p_ate: ate, p_limite: 200, p_offset: pagina * 200,
      });
      if (error) { setErro(error.message); break; }
      const linhas = (data ?? []) as Record<string, unknown>[];
      if (linhas[0]) total = Number(linhas[0].total_pessoas);
      todas.push(...linhas.map((x) => ({
        cd_pessoa: Number(x.cd_pessoa), nome: String(x.nome), grupo: String(x.grupo), valores: paraMapa(x.valores),
      })));
      if (linhas.length < 200 || todas.length >= total) break;
      pagina += 1;
    }
    setSoltas({ linhas: todas, total, carregando: false });
  }, [supabase, empresaId, de, ate]);

  // Lista de soltos só quando a seção está aberta.
  useEffect(() => {
    if (!abertos.has(SEM_VINCULO) || empresaId !== 1 || meses.length === 0) return;
    carregarSoltas(0);
  }, [abertos, carregarSoltas, empresaId, meses.length, versao]);

  async function vincular(cd: number, bloco: string) {
    const { error } = await supabase.from("fc_erp_vinculos").upsert({ empresa_id: empresaId, cd_pessoa: cd, bloco_id: bloco });
    if (error) { setErro(error.message); return; }
    setVersao((v) => v + 1);
  }

  async function regraGrupo(grupo: string, bloco: string) {
    const { error } = bloco
      ? await supabase.from("fc_erp_vinculos_grupo").upsert({ empresa_id: empresaId, grupo, bloco_id: bloco })
      : await supabase.from("fc_erp_vinculos_grupo").delete().eq("empresa_id", empresaId).eq("grupo", grupo);
    if (error) { setErro(error.message); return; }
    setVersao((v) => v + 1);
  }

  async function desvincular(cd: number) {
    const { error } = await supabase.from("fc_erp_vinculos").delete().eq("empresa_id", empresaId).eq("cd_pessoa", cd);
    if (error) { setErro(error.message); return; }
    setVersao((v) => v + 1);
  }

  // ---------- previsto (controle manual) ----------
  const previstoBloco = useMemo(() => {
    const m = new Map<string, number>();
    const somar = (bloco: string, mes: string, v: number) => m.set(`${bloco}|${mes}`, (m.get(`${bloco}|${mes}`) ?? 0) + v);
    for (const l of lancamentos) {
      if (l.status === "cancelado") continue;
      for (const p of l.parcelas) somar(l.bloco_id, mesDe(p.vencimento), p.valor);
    }
    for (const p of premissas) somar(p.tipo === "clientes" ? "recebimentos" : "fornecedores", p.mes, p.valor);
    return m;
  }, [lancamentos, premissas]);

  // previsto por fornecedor, dentro de cada bloco
  const previstoPessoa = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lancamentos) {
      if (l.status === "cancelado" || l.cd_pessoa == null) continue;
      for (const p of l.parcelas) {
        const k = `${l.bloco_id}|${l.cd_pessoa}|${mesDe(p.vencimento)}`;
        m.set(k, (m.get(k) ?? 0) + p.valor);
      }
    }
    return m;
  }, [lancamentos]);

  // ---------- sistema (ERP) ----------
  // Sistema: mês passado = realizado; mês atual = realizado + ainda em aberto; futuro = já lançado.
  const totalErp = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of erp) {
      const conta = r.mes < hoje ? r.situacao === "realizado" : r.mes > hoje ? r.situacao === "aberto" : true;
      if (conta) m.set(r.mes, (m.get(r.mes) ?? 0) + r.valor);
    }
    return m;
  }, [erp, hoje]);

  const totalGrupo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of erp) {
      const conta = r.mes < hoje ? r.situacao === "realizado" : r.mes > hoje ? r.situacao === "aberto" : true;
      if (conta) m.set(`${r.grupo}|${r.mes}`, (m.get(`${r.grupo}|${r.mes}`) ?? 0) + r.valor);
    }
    return m;
  }, [erp, hoje]);

  // Grupo adotado por um bloco entra fechado: o total do grupo menos o que já
  // veio por vínculo de fornecedor, para nada contar duas vezes.
  const restoDoGrupo = useCallback((grupo: string) => {
    const m = new Map<string, number>();
    for (const mes of meses) {
      const v = Math.round(((totalGrupo.get(`${grupo}|${mes}`) ?? 0) - (ligadoGrupo.get(`${grupo}|${mes}`) ?? 0)) * 100) / 100;
      if (v) m.set(mes, v);
    }
    return m;
  }, [meses, totalGrupo, ligadoGrupo]);

  const sistemaBloco = useMemo(() => {
    const m = new Map<string, number>();
    for (const [cd, bloco] of pessoasLigadas) {
      const p = pessoas.get(cd);
      if (!p) continue;
      p.valores.forEach((v, mes) => m.set(`${bloco}|${mes}`, (m.get(`${bloco}|${mes}`) ?? 0) + v));
    }
    for (const [grupo, bloco] of regras) {
      for (const mes of meses) {
        const v = Math.round(((totalGrupo.get(`${grupo}|${mes}`) ?? 0) - (ligadoGrupo.get(`${grupo}|${mes}`) ?? 0)) * 100) / 100;
        if (v) m.set(`${bloco}|${mes}`, (m.get(`${bloco}|${mes}`) ?? 0) + v);
      }
    }
    return m;
  }, [pessoasLigadas, pessoas, regras, meses, totalGrupo, ligadoGrupo]);

  const semVinculo = useMemo(() => {
    const ligado = new Map<string, number>();
    for (const p of pessoas.values()) p.valores.forEach((v, mes) => ligado.set(mes, (ligado.get(mes) ?? 0) + v));
    for (const [grupo] of regras) {
      for (const mes of meses) {
        const v = (totalGrupo.get(`${grupo}|${mes}`) ?? 0) - (ligadoGrupo.get(`${grupo}|${mes}`) ?? 0);
        if (v) ligado.set(mes, (ligado.get(mes) ?? 0) + v);
      }
    }
    const m = new Map<string, number>();
    for (const mes of meses) {
      const v = Math.round(((totalErp.get(mes) ?? 0) - (ligado.get(mes) ?? 0)) * 100) / 100;
      if (v) m.set(mes, v);
    }
    return m;
  }, [pessoas, totalErp, meses, regras, totalGrupo, ligadoGrupo]);

  // ---------- árvore de blocos ----------
  const filhosDe = useCallback((id: string | null) => blocos.filter((b) => (b.pai_id ?? null) === id), [blocos]);

  const somaDaArvore = useCallback((bloco: string, fonte: Map<string, number>): Map<string, number> => {
    const proprio = new Map<string, number>();
    for (const mes of meses) {
      const v = fonte.get(`${bloco}|${mes}`);
      if (v) proprio.set(mes, v);
    }
    return somaMapas([proprio, ...filhosDe(bloco).map((f) => somaDaArvore(f.id, fonte))]);
  }, [meses, filhosDe]);

  const alternar = (id: string) =>
    setAbertos((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (empresaId !== 1) {
    return <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
      O cruzamento com o ERP está disponível só para a renovadora (empresas 1000 a 1024) por enquanto.
    </p>;
  }

  const rotuloSistema = (mes: string) => (mes < hoje ? "Realizado" : mes > hoje ? "No ERP" : "Real.+aberto");

  // Um mês por vez: previsto, o que há no sistema e a diferença entre os dois.
  function celulas(previstoDe: (mes: string) => number, sistemaDe: (mes: string) => number, negrito = false, miudo = false) {
    return meses.map((mes, i) => {
      const p = previstoDe(mes);
      const s = sistemaDe(mes);
      const dif = s - p;
      const rel = p !== 0 ? Math.abs(dif) / Math.abs(p) : dif === 0 ? 0 : 1;
      const aderente = rel <= TOLERANCIA;
      // Mês futuro: as notas ainda não chegaram, então a diferença não é erro —
      // mostra quanto da previsão já está lançado no ERP.
      const futuro = mes > hoje;
      // Com sinais opostos (ex.: previsto de entrada, ERP com saída) a razão não significa nada.
      const cobertura = p !== 0 && (s === 0 || Math.sign(s) === Math.sign(p)) ? Math.round((Math.abs(s) / Math.abs(p)) * 100) : null;
      const cel = cn("px-2 text-right tabular-nums whitespace-nowrap", miudo ? "py-1" : "py-1.5", negrito && "font-bold");
      const vazio = <span className="text-[var(--text-muted)]/40">–</span>;
      const zebra = i % 2 === 1 && "bg-black/[0.015] dark:bg-white/[0.02]";
      return (
        <Fragment key={mes}>
          <td className={cn(cel, "border-l-2 border-slate-200 text-[var(--text-muted)] dark:border-slate-700", zebra)}>
            {p ? formatGrade(p, milhares) : vazio}
          </td>
          <td className={cn(cel, zebra)}>{s ? formatGrade(s, milhares) : vazio}</td>
          {futuro ? (
            <td title={cobertura != null ? `${formatReais(Math.abs(s))} já lançado de ${formatReais(Math.abs(p))} previsto` : undefined}
              className={cn(cel, "pr-3 font-normal text-[var(--text-muted)]", zebra)}>
              {cobertura != null ? `${cobertura}%` : vazio}
            </td>
          ) : (
            <td title={p ? `${dif >= 0 ? "+" : ""}${formatReais(dif)} (${(rel * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do previsto)` : undefined}
              className={cn(cel, "pr-3", zebra,
                !p && !s ? "" : aderente ? "text-[var(--text-muted)]" : dif > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {!p && !s ? vazio : aderente ? "≈" : `${dif > 0 ? "+" : ""}${formatGrade(dif, milhares)}`}
            </td>
          )}
        </Fragment>
      );
    });
  }

  function linha(opts: {
    chave: string; nome: ReactNode; nivel: number; previsto?: Map<string, number>; sistema?: Map<string, number>;
    zebra?: boolean; forte?: boolean; onClick?: () => void; titulo?: string;
  }) {
    const bg = opts.zebra ? "bg-[#F1F2F6] dark:bg-neutral-800" : "bg-[var(--surface)]";
    return (
      <tr key={opts.chave} onClick={opts.onClick}
        className={cn("group border-t border-[var(--border)] hover:bg-[#EDEDFA] dark:hover:bg-[#191934]",
          opts.zebra && "bg-[#F1F2F6] dark:bg-neutral-800", opts.onClick && "cursor-pointer",
          opts.nivel === 0 && "border-t-slate-300 dark:border-t-slate-600")}>
        <td style={{ paddingLeft: recuo(opts.nivel) }} title={opts.titulo}
          className={cn("sticky left-0 z-10 max-w-[38rem] truncate whitespace-nowrap py-1.5 pr-3 shadow-[2px_0_4px_rgba(0,0,0,0.05)]",
            bg, "group-hover:bg-[#EDEDFA] dark:group-hover:bg-[#191934]",
            opts.forte ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]")}>
          {opts.nome}
        </td>
        {celulas((m) => opts.previsto?.get(m) ?? 0, (m) => opts.sistema?.get(m) ?? 0, opts.nivel === 0, opts.nivel > 1)}
      </tr>
    );
  }

  const linhaTexto = (chave: string, conteudo: ReactNode, nivel: number, onClick?: () => void) => (
    <tr key={chave} onClick={onClick} className={cn("border-t border-[var(--border)]", onClick && "group cursor-pointer hover:bg-[#EDEDFA] dark:hover:bg-[#191934]")}>
      <td colSpan={meses.length * 3 + 1} style={{ paddingLeft: recuo(nivel) }}
        className={cn("py-1.5 text-xs text-[var(--text-muted)]", onClick && "group-hover:text-[var(--primary)]")}>
        {conteudo}
      </td>
    </tr>
  );

  // Blocos para escolher no vínculo: o caminho inteiro, para não confundir.
  const caminho = (b: Bloco): string => {
    const pai = b.pai_id ? blocos.find((x) => x.id === b.pai_id) : null;
    return pai ? `${caminho(pai)} › ${b.nome}` : b.nome;
  };
  const opcoesBloco = blocos.map((b) => ({ id: b.id, rotulo: caminho(b) })).sort((a, b) => a.rotulo.localeCompare(b.rotulo));

  const seletorBloco = (cd: number, atual?: string) => (
    <select value={atual ?? ""} onClick={(e) => e.stopPropagation()}
      onChange={(e) => { if (e.target.value) vincular(cd, e.target.value); }}
      className="ml-2 max-w-64 shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[10px] text-[var(--text)]">
      <option value="">vincular a…</option>
      {opcoesBloco.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
    </select>
  );

  // ---------- montagem das linhas ----------
  function linhasDoBloco(b: Bloco, nivel: number): ReactNode[] {
    const fora: ReactNode[] = [];
    // Fornecedores ligados a este bloco (não aos filhos).
    const daqui = [...pessoasLigadas.entries()].filter(([, bloco]) => bloco === b.id);
    for (const [cd] of daqui) {
      const p = pessoas.get(cd);
      const prev = new Map<string, number>();
      for (const mes of meses) {
        const v = previstoPessoa.get(`${b.id}|${cd}|${mes}`);
        if (v) prev.set(mes, v);
      }
      const explicito = vinculos.has(cd);
      fora.push(linha({
        chave: `pe-${b.id}-${cd}`, nivel: nivel + 1, previsto: prev, sistema: p?.valores,
        nome: (
          <span className="inline-flex items-center gap-1">
            <span className="tabular-nums opacity-60">{cd}</span>
            {p?.nome ?? `Pessoa ${cd}`}
            {explicito && (
              <button onClick={(e) => { e.stopPropagation(); desvincular(cd); }} title="Desfazer o vínculo"
                className="rounded p-0.5 text-[var(--text-muted)] hover:text-red-600"><X size={11} /></button>
            )}
          </span>
        ),
      }));
    }
    // Grupo inteiro do ERP adotado por este bloco: entra fechado, sem listar
    // cliente por cliente.
    for (const [grupo, bloco] of regras) {
      if (bloco !== b.id) continue;
      const rotulo = GRUPOS_ERP.find((g) => g.id === grupo)?.rotulo ?? grupo;
      fora.push(linha({
        chave: `rg-${b.id}-${grupo}`, nivel: nivel + 1, sistema: restoDoGrupo(grupo),
        titulo: "Grupo inteiro do ERP, fechado: não abre por cliente",
        nome: <span className="inline-flex items-center gap-1"><i>{rotulo}</i>
          <span className="rounded bg-[#EEEEFD] px-1 text-[9px] font-bold uppercase text-[#0000C2] dark:bg-[#262f6b] dark:text-[#c7c9ff]">grupo</span>
        </span>,
      }));
    }

    // O que o bloco prevê sem apontar fornecedor nenhum.
    const semFornecedor = new Map<string, number>();
    for (const mes of meses) {
      const total = previstoBloco.get(`${b.id}|${mes}`) ?? 0;
      const comFornecedor = daqui.reduce((s, [cd]) => s + (previstoPessoa.get(`${b.id}|${cd}|${mes}`) ?? 0), 0);
      const resto = Math.round((total - comFornecedor) * 100) / 100;
      if (resto) semFornecedor.set(mes, resto);
    }
    if (semFornecedor.size) {
      fora.push(linha({
        chave: `sf-${b.id}`, nivel: nivel + 1, previsto: semFornecedor,
        nome: <i>Previsto sem fornecedor apontado</i>,
        titulo: "Linhas deste bloco que ainda não apontam um fornecedor do ERP",
      }));
    }
    if (fora.length === 0 && filhosDe(b.id).length === 0) {
      fora.push(linhaTexto(`v-${b.id}`, "Nada previsto nem vinculado neste bloco.", nivel + 1));
    }
    return fora;
  }

  function linhasDaArvore(b: Bloco, nivel: number, zebra?: boolean): ReactNode[] {
    const fora: ReactNode[] = [];
    const aberto = abertos.has(b.id);
    const filhos = filhosDe(b.id);
    fora.push(linha({
      chave: `b-${b.id}`, nivel, zebra, forte: true, onClick: () => alternar(b.id),
      previsto: somaDaArvore(b.id, previstoBloco), sistema: somaDaArvore(b.id, sistemaBloco),
      nome: <span className="inline-flex items-center gap-1">{aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{b.nome}</span>,
    }));
    if (!aberto) return fora;
    fora.push(...linhasDoBloco(b, nivel));
    for (const f of filhos) fora.push(...linhasDaArvore(f, nivel + 1));
    return fora;
  }

  const linhas: ReactNode[] = [];
  filhosDe(null).forEach((b, i) => linhas.push(...linhasDaArvore(b, 0, i % 2 === 1)));

  // Seção do que o ERP tem e ninguém reclamou.
  const abertoSoltas = abertos.has(SEM_VINCULO);
  linhas.push(linha({
    chave: "b-sem", nivel: 0, forte: true, sistema: semVinculo, onClick: () => alternar(SEM_VINCULO),
    nome: (
      <span className="inline-flex items-center gap-1">
        {abertoSoltas ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Sem vínculo no ERP
        <span className="font-normal text-[10px] text-[var(--text-muted)]">· títulos de quem ainda não aponta um bloco</span>
      </span>
    ),
  }));
  if (abertoSoltas) {
    for (const s of soltas.linhas) {
      linhas.push(linha({
        chave: `s-${s.cd_pessoa}`, nivel: 1, sistema: s.valores,
        nome: (
          <span className="inline-flex items-center gap-1">
            <span className="tabular-nums opacity-60">{s.cd_pessoa}</span>
            {s.nome}
            {seletorBloco(s.cd_pessoa)}
          </span>
        ),
      }));
    }
    if (soltas.carregando && soltas.linhas.length === 0) {
      linhas.push(linhaTexto("s-carregando", <><Loader2 size={12} className="mr-1 inline animate-spin" />carregando fornecedores…</>, 1));
    } else if (soltas.total > soltas.linhas.length) {
      linhas.push(linhaTexto("s-mais",
        <span className="inline-flex items-center gap-2">
          Mais {(soltas.total - soltas.linhas.length).toLocaleString("pt-BR")} sem vínculo
          <button onClick={(e) => { e.stopPropagation(); if (!soltas.carregando) carregarSoltas(soltas.linhas.length); }}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text)] hover:text-[var(--primary)]">
            {soltas.carregando ? <Loader2 size={10} className="inline animate-spin" /> : `+ ${POR_PAGINA}`}
          </button>
          <button onClick={(e) => { e.stopPropagation(); if (!soltas.carregando) carregarTodas(); }}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text)] hover:text-[var(--primary)]">
            mostrar todos
          </button>
        </span>, 1));
    } else if (soltas.total === 0 && !soltas.carregando) {
      linhaTexto("s-vazio", "Todo o movimento do ERP está vinculado a um bloco.", 1);
    }
  }

  // Regras por grupo do ERP, para ajustar sem sair da tela.
  const abertoRegras = abertos.has(REGRAS);
  linhas.push(linhaTexto("b-regras",
    <span className="inline-flex items-center gap-1 font-semibold text-[var(--text)]">
      {abertoRegras ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      Grupos do ERP ligados direto a um bloco
      <span className="font-normal text-[10px] text-[var(--text-muted)]">· entram fechados, sem abrir por cliente</span>
    </span>, 0, () => alternar(REGRAS)));
  if (abertoRegras) {
    for (const g of GRUPOS_ERP) {
      const bloco = regras.get(g.id);
      linhas.push(linhaTexto(`rg-${g.id}`,
        <span className="inline-flex flex-wrap items-center gap-1">
          {g.rotulo}
          <select value={bloco ?? ""} onChange={(e) => regraGrupo(g.id, e.target.value)}
            className="ml-2 max-w-64 rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[10px] text-[var(--text)]">
            <option value="">fornecedor a fornecedor</option>
            {opcoesBloco.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
        </span>, 1));
    }
  }

  const totalPrevisto = somaMapas(filhosDe(null).map((b) => somaDaArvore(b.id, previstoBloco)));
  const sel = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="cz-de">De</label>
        <select id="cz-de" value={de} onChange={(e) => setDe(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <label className="text-xs text-[var(--text-muted)]" htmlFor="cz-ate">até</label>
        <select id="cz-ate" value={ate} onChange={(e) => setAte(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <span className="text-xs text-[var(--text-muted)]">
          {vinculos.size + pessoasLigadas.size > 0
            ? `${pessoasLigadas.size} fornecedor(es) vinculado(s)`
            : "nenhum fornecedor vinculado ainda"}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {sincronizado ? `ERP sincronizado em ${new Date(sincronizado).toLocaleString("pt-BR")}` : "ERP ainda não sincronizado"}
        </span>
        <button onClick={() => setMilhares((v) => !v)}
          className={cn("ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            milhares ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]")}>
          R$ mil {milhares ? "•" : ""}
        </button>
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      {meses.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">O mês inicial precisa ser anterior ao final.</p>
      ) : (
        <div className={cn("max-h-[calc(100vh-19rem)] min-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]", carregando && "opacity-60")}>
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-white">
                <th rowSpan={2} style={{ backgroundColor: AZUL }} className="sticky left-0 top-0 z-30 min-w-80 px-3 py-2 text-left font-semibold">
                  Bloco / fornecedor {milhares && <span className="font-normal opacity-75">· R$ mil</span>}
                </th>
                {meses.map((m, i) => (
                  <th key={m} colSpan={3} style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }}
                    className={cn("sticky top-0 z-20 border-l-2 border-white/25 px-2 py-1.5 text-center font-semibold", m === hoje && "underline decoration-2 underline-offset-4")}>
                    {rotuloMes(m)}
                  </th>
                ))}
              </tr>
              <tr className="text-white/80">
                {meses.map((m, i) => (
                  <Fragment key={m}>
                    <th style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }} className="sticky top-8 z-20 border-l-2 border-white/25 px-2 py-1 text-right font-normal">Previsto</th>
                    <th style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }} className="sticky top-8 z-20 px-2 py-1 text-right font-normal">{rotuloSistema(m)}</th>
                    <th style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }} className="sticky top-8 z-20 px-2 py-1 pr-3 text-right font-normal">{m > hoje ? "% no ERP" : "Dif."}</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => <Fragment key={i}>{l}</Fragment>)}
              <tr className="border-t-2 border-slate-300 font-extrabold dark:border-slate-600">
                <td className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-2 uppercase tracking-wide text-[var(--text)] shadow-[2px_0_4px_rgba(0,0,0,0.05)]">
                  Total do mês
                </td>
                {celulas((m) => totalPrevisto.get(m) ?? 0, (m) => totalErp.get(m) ?? 0, true)}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-xs text-[var(--text-muted)]">
        <p>
          As linhas são os mesmos blocos do Fluxo próprio. <b>Previsto</b> vem do controle manual (lançamentos ativos e premissas).
          <b> Sistema</b> é o movimento no ERP dos fornecedores vinculados àquele bloco — pelo fornecedor apontado na linha do lançamento
          ou pelo vínculo feito aqui. Abra um bloco para ver fornecedor a fornecedor.
        </p>
        <p>
          <b>Sem vínculo no ERP</b> reúne quem ainda não aponta bloco nenhum; escolha o bloco na caixinha ao lado do nome e ele passa a
          contar na linha certa. O <b>total do mês</b> compara o previsto inteiro com todo o ERP, vinculado ou não.
          Nos meses passados o sistema é o que foi pago e recebido; no mês atual, o realizado mais o que ainda vence; nos futuros, o que já está lançado.
          Ficam fora: títulos reparcelados (status A), incobráveis, adiantamentos e provisões. Só empresas 1000 a 1024.
        </p>
      </div>
    </div>
  );
}
