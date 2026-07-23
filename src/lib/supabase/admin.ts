import { createClient } from "@supabase/supabase-js";

/** Cliente Supabase com service_role — ignora RLS. Usar apenas em API routes server-side. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados");
  return createClient(url, key, { auth: { persistSession: false } });
}
