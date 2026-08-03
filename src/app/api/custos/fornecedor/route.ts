import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EMPRESA_PADRAO = 1; // HOFF

export interface FornecedorDetalhe {
  cd_pessoa: number | null;
  nome: string;
  valor: number[]; // 12 meses
}
export interface UnidadeDetalhe {
  cd_empresa_erp: number;
  nome: string;
  valor: number[]; // 12 meses
  fornecedores: FornecedorDetalhe[];
}
export interface CustoFornecedorResposta {
  codigo: string;
  unidades: UnidadeDetalhe[];
}

/**
 * Detalhe de uma conta gerencial (p_codigo) aberto por unidade → fornecedor,
 * com arrays mensais. Respeita o acesso do usuário via RPC security definer.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const empresaParam = Number(searchParams.get("empresa") ?? EMPRESA_PADRAO);
  const empresa = Number.isInteger(empresaParam) && empresaParam > 0 ? empresaParam : EMPRESA_PADRAO;
  const ano = Number(searchParams.get("ano") ?? new Date().getFullYear());
  const codigo = (searchParams.get("codigo") ?? "").trim();
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) {
    return NextResponse.json({ error: "Ano inválido" }, { status: 400 });
  }
  if (!/^3(\.\d+)*$/.test(codigo)) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("custo_fornecedor_conta", {
    p_empresa: empresa,
    p_ano: ano,
    p_codigo: codigo,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const zeros = () => Array(12).fill(0) as number[];
  type Row = { cd_empresa_erp: number; filial_nome: string; cd_pessoa: number | null; fornecedor_nome: string; mes: number; valor: number };

  const unidades = new Map<number, { nome: string; valor: number[]; forn: Map<string, { cd_pessoa: number | null; nome: string; valor: number[] }> }>();
  for (const r of (data ?? []) as Row[]) {
    const m = r.mes - 1;
    if (m < 0 || m > 11) continue;
    let u = unidades.get(r.cd_empresa_erp);
    if (!u) { u = { nome: r.filial_nome, valor: zeros(), forn: new Map() }; unidades.set(r.cd_empresa_erp, u); }
    u.valor[m] += Number(r.valor);
    const chave = r.cd_pessoa === null ? "null" : String(r.cd_pessoa);
    let f = u.forn.get(chave);
    if (!f) { f = { cd_pessoa: r.cd_pessoa, nome: r.fornecedor_nome, valor: zeros() }; u.forn.set(chave, f); }
    f.valor[m] += Number(r.valor);
  }

  const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const resposta: CustoFornecedorResposta = {
    codigo,
    unidades: [...unidades.entries()]
      .map(([cd_empresa_erp, u]) => ({
        cd_empresa_erp,
        nome: u.nome,
        valor: u.valor,
        fornecedores: [...u.forn.values()].sort((a, b) => soma(a.valor) - soma(b.valor)),
      }))
      .sort((a, b) => soma(a.valor) - soma(b.valor)),
  };

  return NextResponse.json(resposta);
}
