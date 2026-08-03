import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const EMPRESA_PADRAO = 1; // HOFF

interface LinhaUnidade {
  cd_empresa_erp: number;
  filial_nome: string;
  codigo_n2: string;
  mes: number;
  valor: number;
}

export interface UnidadeResumo {
  cd_empresa_erp: number;
  nome: string;
  receita: number[];   // 12 meses (3.1 Receita líquida)
  resultado: number[]; // 12 meses (soma de todos os N2 = lucro líquido)
}

/**
 * Realizado por unidade. A RPC roda com a sessão do usuário (security definer),
 * então respeita o mesmo controle de acesso por unidade/conta do resto do app.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get("ano") ?? new Date().getFullYear());
  const empresaParam = Number(searchParams.get("empresa") ?? EMPRESA_PADRAO);
  const empresa = Number.isInteger(empresaParam) && empresaParam > 0 ? empresaParam : EMPRESA_PADRAO;
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) {
    return NextResponse.json({ error: "Ano inválido" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("dre_realizado_por_unidade", {
    p_empresa: empresa,
    p_ano: ano,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const zeros = () => Array(12).fill(0) as number[];
  const mapa = new Map<number, UnidadeResumo>();

  for (const l of (data ?? []) as LinhaUnidade[]) {
    let u = mapa.get(l.cd_empresa_erp);
    if (!u) {
      u = { cd_empresa_erp: l.cd_empresa_erp, nome: l.filial_nome, receita: zeros(), resultado: zeros() };
      mapa.set(l.cd_empresa_erp, u);
    }
    const m = l.mes - 1;
    u.resultado[m] += Number(l.valor);
    if (l.codigo_n2 === "3.1") u.receita[m] += Number(l.valor);
  }

  const unidades = [...mapa.values()].sort((a, b) => a.cd_empresa_erp - b.cd_empresa_erp);
  return NextResponse.json({ ano, unidades });
}
