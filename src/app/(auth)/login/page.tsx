"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  const router = useRouter();
  const supabase = createClient();

  async function handleReset() {
    setError("");
    setResetMsg("");
    if (!email) {
      setError("Digite o seu e-mail acima para receber o link de redefinição.");
      return;
    }
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setResetLoading(false);
    if (error) {
      setError("Não foi possível enviar o e-mail agora. Tente novamente.");
    } else {
      setResetMsg("Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha. Verifique a sua caixa de entrada (e o spam).");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : "Erro ao entrar. Tente novamente."
      );
      setLoading(false);
      return;
    }

    router.push("/dre");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Coluna do formulário */}
      <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12 lg:flex-none lg:px-20 xl:px-32">
        <div className="mx-auto w-full max-w-sm lg:w-96 flex flex-col gap-8">
        {/* Marca */}
        <div className="flex flex-col gap-4">
          <div className="bg-[#0000FE] text-white p-3 w-fit">
            <BarChart3 size={32} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-8 tracking-tight text-gray-900 uppercase">
              Portal Hoff
            </h1>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#0000FE] mt-0.5">
              Controladoria
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Entre com a sua conta para acessar o painel
            </p>
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <Input
            label="E-mail"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Senha</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0000C2] focus:border-transparent hover:border-gray-400"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetLoading}
              className="self-end text-xs font-medium text-[#0000FE] hover:underline disabled:opacity-50"
            >
              {resetLoading ? "Enviando…" : "Esqueci minha senha"}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {resetMsg && (
            <div className="bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              {resetMsg}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            loading={loading}
            className="w-full mt-1"
          >
            Entrar
          </Button>
        </form>

        <p className="text-xs text-gray-400">
          Acesso restrito a usuários autorizados · Portal Hoff Controladoria &copy; {new Date().getFullYear()}
        </p>
        </div>
      </div>

      {/* Painel da marca (desktop) */}
      <div className="relative w-0 flex-1 hidden lg:flex items-center justify-center bg-gradient-to-br from-[#0000FE] via-[#0000C2] to-[#00008E]">
        <div className="text-center text-white px-12">
          <p className="text-5xl font-bold uppercase tracking-tight">Hoff</p>
          <p className="mt-3 text-sm uppercase tracking-[0.3em] text-white/70">
            DRE · Planejado vs Realizado
          </p>
        </div>
      </div>
    </div>
  );
}
