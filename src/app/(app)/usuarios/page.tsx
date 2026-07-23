import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShieldAlert } from "lucide-react";
import CriarUsuarioForm from "@/components/usuarios/CriarUsuarioForm";
import UsuariosTabela, { type UsuarioLinha } from "@/components/usuarios/UsuariosTabela";
import type { UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();

  const { data: perfil } = user
    ? await authClient.from("profiles").select("role, ativo").eq("id", user.id).single()
    : { data: null };

  if (!user || perfil?.role !== "admin" || perfil?.ativo === false) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <ShieldAlert size={32} className="text-red-500" />
        <p className="text-sm text-[var(--text-muted)]">Apenas administradores podem acessar esta página.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const [{ data: authUsers }, { data: perfis }, { data: vFiliais }, { data: vContas }] = await Promise.all([
    admin.auth.admin.listUsers(),
    admin.from("profiles").select("id,nome,role,ativo,restringe_empresas,restringe_contas,pode_sincronizar,pode_ver_viagens,pode_importar_viagens,pode_ver_auditoria"),
    admin.from("usuario_filiais").select("user_id"),
    admin.from("usuario_contas").select("user_id"),
  ]);

  type PerfilRow = {
    id: string; nome: string; role: UserRole; ativo: boolean;
    restringe_empresas: boolean; restringe_contas: boolean; pode_sincronizar: boolean;
    pode_ver_viagens: boolean; pode_importar_viagens: boolean; pode_ver_auditoria: boolean;
  };
  const perfilPorId = new Map((perfis ?? []).map(p => [p.id as string, p as PerfilRow]));
  const contaVinculos = (lista: { user_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const v of lista ?? []) m.set(v.user_id, (m.get(v.user_id) ?? 0) + 1);
    return m;
  };
  const filiaisPorUser = contaVinculos(vFiliais);
  const contasPorUser = contaVinculos(vContas);

  const usuarios: UsuarioLinha[] = (authUsers?.users ?? [])
    .map(u => ({
      id: u.id,
      email: u.email ?? "-",
      nome: perfilPorId.get(u.id)?.nome ?? (u.user_metadata?.nome as string | undefined) ?? "-",
      role: perfilPorId.get(u.id)?.role ?? "gestor",
      ativo: perfilPorId.get(u.id)?.ativo ?? true,
      restringeEmpresas: perfilPorId.get(u.id)?.restringe_empresas ?? true,
      restringeContas: perfilPorId.get(u.id)?.restringe_contas ?? true,
      ultimoLogin: u.last_sign_in_at ?? null,
      unidadesVinculadas: filiaisPorUser.get(u.id) ?? 0,
      contasVinculadas: contasPorUser.get(u.id) ?? 0,
      podeSincronizar: perfilPorId.get(u.id)?.pode_sincronizar ?? false,
      podeVerViagens: perfilPorId.get(u.id)?.pode_ver_viagens ?? false,
      podeImportarViagens: perfilPorId.get(u.id)?.pode_importar_viagens ?? false,
      podeVerAuditoria: perfilPorId.get(u.id)?.pode_ver_auditoria ?? false,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Usuários</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {usuarios.length} usuário{usuarios.length !== 1 ? "s" : ""} com acesso ao sistema.
          Usuários comuns enxergam apenas as empresas e contas vinculadas a eles.
        </p>
      </div>

      <CriarUsuarioForm />

      <UsuariosTabela usuarios={usuarios} currentUserId={user.id} />
    </div>
  );
}
