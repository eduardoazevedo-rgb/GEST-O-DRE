import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface LinhaViagem {
  ano: number; mes: number; dt_emissao: string | null;
  cd_empresa: number | null; documento: string | null;
  cd_pessoa: number | null; nm_pessoa: string | null;
  cd_item: string | null; ds_item: string | null; tipo: string;
  qtd: number | null; vlr_item: number | null;
  cd_centrocusto: string | null; ds_centrocusto: string | null;
  cd_conta: string | null; ds_conta: string | null;
  obs: string | null; obs2: string | null;
  vlr_cc: number; viajante: string | null;
}

/** Importa linhas de custo de viagens. Substitui os meses presentes no arquivo. */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { data: perfil } = await supabase
    .from("profiles").select("role, ativo, pode_importar_viagens").eq("id", user.id).single();
  const podeImportar = perfil?.ativo !== false && (perfil?.role === "admin" || perfil?.pode_importar_viagens === true);
  if (!podeImportar) return NextResponse.json({ error: "Sem permissão para importar viagens" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { arquivo?: string; linhas?: LinhaViagem[] };
  const linhas = body.linhas ?? [];
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha para importar" }, { status: 400 });
  }

  // meses presentes (AAAA-MM)
  const mesesSet = new Set<string>();
  for (const l of linhas) {
    if (!Number.isInteger(l.ano) || !Number.isInteger(l.mes) || l.mes < 1 || l.mes > 12) {
      return NextResponse.json({ error: "Há linhas com data inválida" }, { status: 400 });
    }
    mesesSet.add(`${l.ano}-${String(l.mes).padStart(2, "0")}`);
  }
  const meses = [...mesesSet].sort();

  const admin = createAdminClient();

  // registro da importação
  const { data: imp, error: impErr } = await admin.from("viagens_importacoes")
    .insert({ arquivo: body.arquivo ?? null, meses, linhas: linhas.length, importado_por: user.id })
    .select("id").single();
  if (impErr || !imp) return NextResponse.json({ error: impErr?.message ?? "Falha ao registrar importação" }, { status: 500 });

  try {
    // substitui os meses presentes
    for (const ym of meses) {
      const [a, m] = ym.split("-").map(Number);
      const { error } = await admin.from("custo_viagens").delete().eq("ano", a).eq("mes", m);
      if (error) throw new Error(`Limpeza ${ym}: ${error.message}`);
    }
    // insere
    const registros = linhas.map((l) => ({ ...l, importacao_id: imp.id }));
    for (let i = 0; i < registros.length; i += 500) {
      const { error } = await admin.from("custo_viagens").insert(registros.slice(i, i + 500));
      if (error) throw new Error(`Insert: ${error.message}`);
    }
  } catch (e) {
    // desfaz o registro se algo falhar (cascade apaga linhas já inseridas)
    await admin.from("viagens_importacoes").delete().eq("id", imp.id);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, linhas: linhas.length, meses });
}
