"use client";

import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { moduloDaRota, rotuloModulo } from "@/lib/modulos";

/**
 * Trava de navegação por módulo: mesmo digitando a URL na mão, quem não tem o
 * módulo liberado não vê a tela. É a camada visual — os dados em si continuam
 * protegidos pelo RLS/RPC do Supabase.
 */
export default function GuardaModulo({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loading, podeVerModulo } = useAuth();
  const modulo = moduloDaRota(pathname);

  if (!modulo || loading) return <>{children}</>;
  if (podeVerModulo(modulo)) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <ShieldAlert size={32} className="text-red-500" />
      <div>
        <p className="text-sm font-semibold text-[var(--text)]">Sem acesso a {rotuloModulo(modulo)}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Peça a um administrador para liberar este módulo para o seu usuário.
        </p>
      </div>
    </div>
  );
}
