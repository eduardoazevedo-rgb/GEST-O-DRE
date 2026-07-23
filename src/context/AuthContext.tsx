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

interface Profile {
  id: string;
  nome: string;
  role: UserRole;
  pode_sincronizar?: boolean;
  pode_ver_viagens?: boolean;
  pode_importar_viagens?: boolean;
  pode_ver_auditoria?: boolean;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  podeSincronizar: boolean;
  podeVerViagens: boolean;
  podeImportarViagens: boolean;
  podeVerAuditoria: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  podeSincronizar: false,
  podeVerViagens: false,
  podeImportarViagens: false,
  podeVerAuditoria: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome, role, pode_sincronizar, pode_ver_viagens, pode_importar_viagens, pode_ver_auditoria")
      .eq("id", userId)
      .single();
    setProfile(data ?? null);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) fetchProfile(user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setProfile(null);
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
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAdmin: profile?.role === "admin",
        podeSincronizar: profile?.role === "admin" || profile?.pode_sincronizar === true,
        podeVerViagens: profile?.role === "admin" || profile?.pode_ver_viagens === true,
        podeImportarViagens: profile?.role === "admin" || profile?.pode_importar_viagens === true,
        podeVerAuditoria: profile?.role === "admin" || profile?.pode_ver_auditoria === true,
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
