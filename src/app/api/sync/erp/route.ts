import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sincronizarRealizado } from "@/lib/dre/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sincroniza o realizado do ERP para o Supabase.
 * Autorização: usuário admin logado OU header Authorization: Bearer <CRON_SECRET>.
 * Só funciona quando o servidor consegue alcançar o Firebird (rede local) —
 * na Vercel use o script `npm run sync` rodando na máquina da empresa.
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization");
  const viaCron = !!process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`;

  if (!viaCron) {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Apenas administradores" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get("ano") ?? new Date().getFullYear());
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) {
    return NextResponse.json({ error: "Ano inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: log } = await admin
    .from("sync_log")
    .insert({ ano, status: "executando" })
    .select("id")
    .single();

  try {
    const { linhas } = await sincronizarRealizado(ano);
    if (log) {
      await admin
        .from("sync_log")
        .update({ status: "ok", linhas, finalizado_em: new Date().toISOString() })
        .eq("id", log.id);
    }
    return NextResponse.json({ ok: true, ano, linhas });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    if (log) {
      await admin
        .from("sync_log")
        .update({ status: "erro", mensagem, finalizado_em: new Date().toISOString() })
        .eq("id", log.id);
    }
    console.error("[sync/erp]", err);
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }
}
