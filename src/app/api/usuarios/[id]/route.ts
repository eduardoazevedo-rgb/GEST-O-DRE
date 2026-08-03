import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ehModulo } from "@/lib/modulos";

interface PatchBody {
  nome?: string;
  role?: string;
  senha?: string;
  ativo?: boolean;
  pode_sincronizar?: boolean;
  pode_importar_viagens?: boolean;
  /** Lista completa de módulos liberados (substitui a atual). */
  modulos?: string[];
}

/** Edita nome/perfil/senha e ativa/desativa um usuário (só admin). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard.user === null) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as PatchBody;

  const nome = body.nome?.trim();
  const role = body.role === undefined ? undefined : body.role === "admin" ? "admin" : "gestor";
  const senha = body.senha;
  const ativo = body.ativo;

  if (nome !== undefined && !nome) return NextResponse.json({ error: "Nome não pode ficar vazio" }, { status: 400 });
  if (senha !== undefined && senha.length < 6) {
    return NextResponse.json({ error: "Senha deve ter ao menos 6 caracteres" }, { status: 400 });
  }
  // Proteção: admin não se desativa nem se rebaixa (evita trancar o sistema)
  if (id === guard.user.id && (ativo === false || role === "gestor")) {
    return NextResponse.json({ error: "Você não pode desativar ou rebaixar o seu próprio usuário" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Auth: senha e bloqueio de login
  if (senha !== undefined) {
    const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (ativo !== undefined) {
    // ban impede novos logins; o RLS (is_usuario_ativo) corta o acesso das sessões existentes
    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: ativo ? "none" : "876000h",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Perfil
  const campos: Record<string, unknown> = {};
  if (nome !== undefined) campos.nome = nome;
  if (role !== undefined) campos.role = role;
  if (ativo !== undefined) campos.ativo = ativo;
  if (body.pode_sincronizar !== undefined) campos.pode_sincronizar = body.pode_sincronizar === true;
  if (body.pode_importar_viagens !== undefined) campos.pode_importar_viagens = body.pode_importar_viagens === true;
  if (Object.keys(campos).length > 0) {
    const { error } = await admin.from("profiles").update(campos).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Módulos: a lista recebida vira a lista do usuário (troca completa).
  if (body.modulos !== undefined) {
    const modulos = [...new Set(body.modulos.filter(ehModulo))];
    const { error: errDel } = await admin.from("usuario_modulos").delete().eq("user_id", id);
    if (errDel) return NextResponse.json({ error: errDel.message }, { status: 400 });
    if (modulos.length > 0) {
      const { error: errIns } = await admin
        .from("usuario_modulos")
        .insert(modulos.map((modulo) => ({ user_id: id, modulo })));
      if (errIns) return NextResponse.json({ error: errIns.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
