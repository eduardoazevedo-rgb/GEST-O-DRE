import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({})) as { nome?: string; email?: string; senha?: string; role?: string };
  const nome = body.nome?.trim();
  const email = body.email?.trim().toLowerCase();
  const senha = body.senha ?? "";
  const role = body.role === "admin" ? "admin" : "gestor";

  if (!nome) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  if (senha.length < 6) return NextResponse.json({ error: "Senha deve ter ao menos 6 caracteres" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, role },
  });

  if (error) {
    const msg = error.message.toLowerCase().includes("already been registered")
      ? "Já existe um usuário com esse e-mail"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ id: data.user.id, email: data.user.email, nome, role });
}
