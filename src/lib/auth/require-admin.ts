import { createClient as createServerClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

type GuardResult =
  | { user: User; error: null; status: 200 }
  | { user: null; error: string; status: 401 | 403 };

/**
 * Garante que a requisição vem de um administrador ativo.
 * Toda rota /api/usuarios/* deve passar por aqui antes de usar o
 * client service-role (que ignora RLS).
 */
export async function requireAdmin(): Promise<GuardResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Não autorizado", status: 401 };

  const { data: perfil } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .single();

  if (perfil?.role !== "admin" || perfil?.ativo === false) {
    return { user: null, error: "Apenas administradores podem executar esta ação", status: 403 };
  }
  return { user, error: null, status: 200 };
}
