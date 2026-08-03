"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface Empresa {
  id: number;
  codigo: string;
  nome: string;
}

interface EmpresaContextValue {
  empresas: Empresa[];
  empresaId: number;
  empresa: Empresa | null;
  setEmpresaId: (id: number) => void;
  carregando: boolean;
}

const PADRAO = 1; // HOFF
const CHAVE = "empresa-selecionada";

const EmpresaContext = createContext<EmpresaContextValue>({
  empresas: [], empresaId: PADRAO, empresa: null, setEmpresaId: () => {}, carregando: true,
});

/**
 * Empresa em que o portal está posicionado. Cada empresa tem realizado, plano de
 * contas, orçamento e permissões próprios — a escolha aqui vale para todas as
 * telas. A lista respeita o vínculo do usuário (usuario_empresas), então quem só
 * tem a HOFF nem vê o seletor.
 */
export function EmpresaProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaIdState] = useState<number>(PADRAO);
  const [carregando, setCarregando] = useState(true);
  const supabase = createClient();

  const setEmpresaId = useCallback((id: number) => {
    setEmpresaIdState(id);
    try { window.localStorage.setItem(CHAVE, String(id)); } catch { /* modo privado */ }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setEmpresas([]); setCarregando(false); return; }
    let vivo = true;
    (async () => {
      // O RLS de empresas já corta o que o usuário não pode ver; o vínculo
      // explícito (usuario_empresas) refina quando o perfil é restrito.
      const [{ data: todas }, { data: perfil }, { data: vinculos }] = await Promise.all([
        supabase.from("empresas").select("id, codigo, nome").order("id"),
        supabase.from("profiles").select("restringe_empresas").eq("id", user.id).single(),
        supabase.from("usuario_empresas").select("empresa_id").eq("user_id", user.id),
      ]);
      if (!vivo) return;
      const lista = (todas ?? []) as Empresa[];
      const restrito = !isAdmin && perfil?.restringe_empresas !== false;
      const permitidas = restrito
        ? lista.filter((e) => (vinculos ?? []).some((v: { empresa_id: number }) => v.empresa_id === e.id))
        : lista;
      setEmpresas(permitidas);

      let inicial = PADRAO;
      try {
        const salvo = Number(window.localStorage.getItem(CHAVE));
        if (Number.isInteger(salvo) && salvo > 0) inicial = salvo;
      } catch { /* ignora */ }
      if (!permitidas.some((e) => e.id === inicial)) inicial = permitidas[0]?.id ?? PADRAO;
      setEmpresaIdState(inicial);
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, isAdmin]);

  return (
    <EmpresaContext.Provider
      value={{
        empresas, empresaId, empresa: empresas.find((e) => e.id === empresaId) ?? null,
        setEmpresaId, carregando,
      }}
    >
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresa() {
  return useContext(EmpresaContext);
}
