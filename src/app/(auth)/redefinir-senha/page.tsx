"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart3, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";

export default function RedefinirSenhaPage() {
  const supabase = createClient();
  const router = useRouter();
  const [verificando, setVerificando] = useState(true);
  const [pronto, setPronto] = useState(false); // sessão de recuperação ativa
  const [erroLink, setErroLink] = useState("");

  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const errDesc = url.searchParams.get("error_description");

    if (errDesc) {
      setErroLink("Link inválido ou expirado. Solicite um novo na tela de login.");
      setVerificando(false);
      return;
    }

    // Fluxo PKCE (@supabase/ssr): o link volta com ?code=… para trocar por sessão.
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setErroLink("Link inválido ou expirado. Solicite um novo na tela de login.");
        else setPronto(true);
        setVerificando(false);
        window.history.replaceState({}, "", "/redefinir-senha");
      });
      return;
    }

    // Sem code: pode já existir sessão de recuperação (fluxo por hash) ou evento tardio.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) { setPronto(true); setVerificando(false); }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setPronto(true);
      else setErroLink("Abra esta página pelo link enviado ao seu e-mail.");
      setVerificando(false);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (senha.length < 6) { setErro("A senha deve ter ao menos 6 caracteres."); return; }
    if (senha !== confirmar) { setErro("As senhas não conferem."); return; }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) { setErro("Não foi possível salvar a nova senha. Tente novamente."); return; }
    setSucesso(true);
    setTimeout(() => { router.push("/dre"); router.refresh(); }, 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div className="bg-[#0000FE] text-white p-3 w-fit">
            <BarChart3 size={32} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-8 tracking-tight text-gray-900 uppercase">Nova senha</h1>
            <p className="text-sm text-gray-500 mt-1">Defina a senha que você usará para acessar o Portal Hoff Controladoria.</p>
          </div>
        </div>

        {verificando ? (
          <p className="text-sm text-gray-500">Verificando o link…</p>
        ) : sucesso ? (
          <div className="bg-emerald-50 border border-emerald-200 px-3 py-3 text-sm text-emerald-700">
            Senha alterada com sucesso. Redirecionando…
          </div>
        ) : pronto ? (
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
            {(["Nova senha", "Confirmar nova senha"] as const).map((rot, i) => (
              <div key={rot} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">{rot}</label>
                <div className="relative">
                  <input
                    type={mostrar ? "text" : "password"}
                    placeholder="••••••••"
                    value={i === 0 ? senha : confirmar}
                    onChange={(e) => (i === 0 ? setSenha : setConfirmar)(e.target.value)}
                    autoComplete="new-password"
                    className="w-full border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0000C2] focus:border-transparent hover:border-gray-400"
                    required
                  />
                  {i === 0 && (
                    <button type="button" onClick={() => setMostrar(!mostrar)} tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {mostrar ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {erro && <div className="bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{erro}</div>}
            <Button type="submit" size="lg" loading={salvando} className="w-full mt-1">Salvar nova senha</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{erroLink}</div>
            <Link href="/login" className="text-sm font-medium text-[#0000FE] hover:underline">Voltar ao login</Link>
          </div>
        )}
      </div>
    </div>
  );
}
