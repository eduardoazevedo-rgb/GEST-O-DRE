"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dices, X } from "lucide-react";
import { userRoleOptions } from "@/lib/labels";
import { useToast } from "@/context/ToastContext";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import type { UsuarioLinha } from "./UsuariosTabela";

function gerarSenha(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

interface Props {
  usuario: UsuarioLinha;
  isSelf: boolean;
  onClose: () => void;
}

export default function EditarUsuarioModal({ usuario, isSelf, onClose }: Props) {
  const [nome, setNome] = useState(usuario.nome);
  const [role, setRole] = useState<string>(usuario.role);
  const [podeSincronizar, setPodeSincronizar] = useState<boolean>(usuario.podeSincronizar);
  const [podeVerViagens, setPodeVerViagens] = useState<boolean>(usuario.podeVerViagens);
  const [podeImportarViagens, setPodeImportarViagens] = useState<boolean>(usuario.podeImportarViagens);
  const [podeVerAuditoria, setPodeVerAuditoria] = useState<boolean>(usuario.podeVerAuditoria);
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { toast("Nome não pode ficar vazio", "error"); return; }
    if (senha && senha.length < 6) { toast("Senha deve ter ao menos 6 caracteres", "error"); return; }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        nome: nome.trim(), role, pode_sincronizar: podeSincronizar,
        pode_ver_viagens: podeVerViagens, pode_importar_viagens: podeImportarViagens,
        pode_ver_auditoria: podeVerAuditoria,
      };
      if (senha) body.senha = senha;
      const res = await fetch(`/api/usuarios/${usuario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Erro ao salvar", "error");
      } else {
        toast(senha ? "Usuário atualizado — repasse a nova senha." : "Usuário atualizado.");
        router.refresh();
        onClose();
      }
    } catch {
      toast("Erro de conexão com o servidor", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text)]">Editar usuário</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={18} /></button>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{usuario.email}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nome completo" value={nome} onChange={e => setNome(e.target.value)} />
          <Select
            label="Perfil"
            value={role}
            onChange={e => setRole(e.target.value)}
            options={userRoleOptions}
            disabled={isSelf}
          />
          {isSelf && <p className="text-xs text-[var(--text-muted)] -mt-2">Você não pode alterar o próprio perfil.</p>}

          {role === "admin" ? (
            <p className="text-xs text-[var(--text-muted)]">Administradores têm todas as permissões (sincronizar, viagens e auditoria).</p>
          ) : (
            <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Permissões</p>
              <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none">
                <input type="checkbox" checked={podeSincronizar} onChange={(e) => setPodeSincronizar(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]" />
                Disparar a sincronização (botão &ldquo;Atualizar agora&rdquo;)
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none">
                <input type="checkbox" checked={podeVerViagens} onChange={(e) => setPodeVerViagens(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]" />
                Ver a aba Custo de Viagens
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none">
                <input type="checkbox" checked={podeImportarViagens}
                  onChange={(e) => { setPodeImportarViagens(e.target.checked); if (e.target.checked) setPodeVerViagens(true); }}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]" />
                Importar planilhas de viagens
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none">
                <input type="checkbox" checked={podeVerAuditoria} onChange={(e) => setPodeVerAuditoria(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]" />
                Ver a aba Auditoria (ajustes de inventário)
              </label>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Nova senha (opcional)</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Deixe em branco para manter"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-mono bg-[var(--surface)] text-[var(--text)]
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:border-gray-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => setSenha(gerarSenha())}
                title="Gerar senha aleatória"
                className="shrink-0 px-3 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--border)] transition-colors"
              >
                <Dices size={16} />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
            <Button type="submit" loading={loading}>Salvar</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
