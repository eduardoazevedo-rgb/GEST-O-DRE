"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";
import { MODULOS_IDS, type ModuloId } from "@/lib/modulos";

interface Profile {
  id: string;
  nome: string;
  role: UserRole;
  pode_sincronizar?: boolean;
  pode_importar_viagens?: boolean;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  podeSincronizar: boolean;
  podeImportarViagens: boolean;
  /** Módulos liberados (admin = todos). */
  modulos: ModuloId[];
  podeVerModulo: (m: ModuloId) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  podeSincronizar: false,
  podeImportarViagens: false,
  modulos: [],
  podeVerModulo: () => false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [modulos, setModulos] = useState<ModuloId[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  async function fetchProfile(userId: string) {
    const [{ data }, { data: mods }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, nome, role, pode_sincronizar, pode_importar_viagens")
        .eq("id", userId)
        .single(),
      supabase.from("usuario_modulos").select("modulo").eq("user_id", userId),
    ]);
    setProfile(data ?? null);
    setModulos((mods ?? []).map((m: { modulo: string }) => m.modulo as ModuloId));
  }

  useEffect(() => {
    // O perfil (e os módulos) tem de chegar ANTES de loading virar false: a
    // trava por módulo lê essa lista e não pode julgar com ela ainda vazia.
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setUser(user);
      if (user) await fetchProfile(user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          setLoading(true);
          await fetchProfile(session.user.id);
          setLoading(false);
        } else {
          setProfile(null);
          setModulos([]);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setModulos([]);
  }

  const isAdmin = profile?.role === "admin";

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAdmin,
        podeSincronizar: isAdmin || profile?.pode_sincronizar === true,
        podeImportarViagens: (isAdmin || profile?.pode_importar_viagens === true) && (isAdmin || modulos.includes("viagens")),
        modulos: isAdmin ? MODULOS_IDS : modulos,
        podeVerModulo: (m) => isAdmin || modulos.includes(m),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
