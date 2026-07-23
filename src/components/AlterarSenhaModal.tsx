"use client";

import { useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/context/ToastContext";
import Button from "@/components/ui/Button";

/** Deixa o usuário logado trocar a própria senha (sem depender do admin nem de e-mail). */
export default function AlterarSenhaModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { toast } = useToast();
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) { toast("A senha deve ter ao menos 6 caracteres", "error"); return; }
    if (senha !== confirmar) { toast("As senhas não conferem", "error"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setLoading(false);
    if (error) { toast("Não foi possível alterar a senha. Entre novamente e tente de novo.", "error"); return; }
    toast("Senha alterada com sucesso.");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text)]">Alterar senha</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {(["Nova senha", "Confirmar nova senha"] as const).map((rot, i) => (
            <div key={rot} className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{rot}</label>
              <div className="relative">
                <input
                  type={mostrar ? "text" : "password"}
                  placeholder="••••••••"
                  value={i === 0 ? senha : confirmar}
                  onChange={(e) => (i === 0 ? setSenha : setConfirmar)(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2 pr-10 text-sm bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:border-gray-400 transition-colors"
                  required
                />
                {i === 0 && (
                  <button type="button" onClick={() => setMostrar(!mostrar)} tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]">
                    {mostrar ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
            <Button type="submit" loading={loading}>Salvar</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
