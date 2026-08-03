import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ehModulo, MODULOS_PADRAO } from "@/lib/modulos";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({})) as
    { nome?: string; email?: string; senha?: string; role?: string; modulos?: string[] };
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

  // Módulos do usuário novo (o gatilho do profile já rodou junto com o create).
  if (role !== "admin") {
    const modulos = body.modulos === undefined
      ? MODULOS_PADRAO
      : [...new Set(body.modulos.filter(ehModulo))];
    if (modulos.length > 0) {
      await admin.from("usuario_modulos").insert(modulos.map((modulo) => ({ user_id: data.user.id, modulo })));
    }
  }

  return NextResponse.json({ id: data.user.id, email: data.user.email, nome, role });
}
