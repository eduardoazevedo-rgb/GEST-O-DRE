"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Link2, Power } from "lucide-react";
import { userRoleLabel } from "@/lib/labels";
import { useToast } from "@/context/ToastContext";
import type { UserRole } from "@/lib/types";
import { MODULOS_IDS, rotuloModulo, type ModuloId } from "@/lib/modulos";
import Badge from "@/components/ui/Badge";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EditarUsuarioModal from "./EditarUsuarioModal";
import VinculosModal from "./VinculosModal";

export interface UsuarioLinha {
  id: string;
  email: string;
  nome: string;
  role: UserRole;
  ativo: boolean;
  restringeEmpresas: boolean;
  restringeContas: boolean;
  ultimoLogin: string | null;
  unidadesVinculadas: number;
  contasVinculadas: number;
  podeSincronizar: boolean;
  podeImportarViagens: boolean;
  modulos: ModuloId[];
}

function resumoVinculos(u: UsuarioLinha): string {
  const unidades = u.restringeEmpresas
    ? `${u.unidadesVinculadas} unidade${u.unidadesVinculadas !== 1 ? "s" : ""}`
    : "Todas as unidades";
  const contas = u.restringeContas
    ? `${u.contasVinculadas} conta${u.contasVinculadas !== 1 ? "s" : ""}`
    : "Todas as contas";
  return `${unidades} · ${contas}`;
}

function resumoModulos(modulos: ModuloId[]) {
  if (modulos.length === 0) return <span className="text-red-600 dark:text-red-400">Nenhum</span>;
  if (modulos.length === MODULOS_IDS.length) return "Todos";
  const nomes = MODULOS_IDS.filter((m) => modulos.includes(m)).map(rotuloModulo);
  return <span className="block truncate" title={nomes.join(" · ")}>{nomes.join(" · ")}</span>;
}

interface Props {
  usuarios: UsuarioLinha[];
  currentUserId: string;
}

export default function UsuariosTabela({ usuarios, currentUserId }: Props) {
  const [editando, setEditando] = useState<UsuarioLinha | null>(null);
  const [vinculando, setVinculando] = useState<UsuarioLinha | null>(null);
  const [desativando, setDesativando] = useState<UsuarioLinha | null>(null);
  const [loadingAtivo, setLoadingAtivo] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function alterarAtivo(u: UsuarioLinha, ativo: boolean) {
    setLoadingAtivo(true);
    try {
      const res = await fetch(`/api/usuarios/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Erro ao atualizar usuário", "error");
      } else {
        toast(ativo ? `${u.nome} reativado.` : `${u.nome} desativado.`);
        router.refresh();
      }
    } catch {
      toast("Erro de conexão com o servidor", "error");
    } finally {
      setLoadingAtivo(false);
      setDesativando(null);
    }
  }

  return (
    <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)]">
            <tr className="text-[var(--text-muted)]">
              <th className="text-left px-4 py-3 font-medium">Nome</th>
              <th className="text-left px-4 py-3 font-medium">E-mail</th>
              <th className="text-left px-4 py-3 font-medium">Perfil</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Vínculos</th>
              <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Módulos</th>
              <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Último acesso</th>
              <th className="text-right px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {usuarios.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-[var(--text-muted)]">Nenhum usuário encontrado.</td></tr>
            ) : usuarios.map(u => (
              <tr key={u.id} className={`hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors ${!u.ativo ? "opacity-60" : ""}`}>
                <td className="px-4 py-3 font-medium text-[var(--text)]">{u.nome}</td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={u.role === "admin" ? "blue" : "gray"}>{userRoleLabel[u.role]}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={u.ativo ? "green" : "red"}>{u.ativo ? "Ativo" : "Desativado"}</Badge>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] hidden md:table-cell">
                  {u.role === "admin" ? "Tudo (admin)" : resumoVinculos(u)}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] hidden lg:table-cell max-w-56">
                  {u.role === "admin" ? "Todos (admin)" : resumoModulos(u.modulos)}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] hidden sm:table-cell">
                  {u.ultimoLogin ? new Date(u.ultimoLogin).toLocaleString("pt-BR") : "Nunca"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {u.role !== "admin" && (
                      <button
                        title="Vínculos de empresas e contas"
                        onClick={() => setVinculando(u)}
                        className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-blue-600 transition-colors"
                      >
                        <Link2 size={15} />
                      </button>
                    )}
                    <button
                      title="Editar usuário"
                      onClick={() => setEditando(u)}
                      className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-blue-600 transition-colors"
                    >
                      <Pencil size={15} />
                    </button>
                    {u.id !== currentUserId && (
                      <button
                        title={u.ativo ? "Desativar usuário" : "Reativar usuário"}
                        onClick={() => (u.ativo ? setDesativando(u) : alterarAtivo(u, true))}
                        className={`p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--border)] transition-colors ${u.ativo ? "hover:text-red-600" : "hover:text-green-600"}`}
                      >
                        <Power size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <EditarUsuarioModal
          usuario={editando}
          isSelf={editando.id === currentUserId}
          onClose={() => setEditando(null)}
        />
      )}
      {vinculando && (
        <VinculosModal usuario={vinculando} onClose={() => setVinculando(null)} />
      )}
      <ConfirmDialog
        open={desativando !== null}
        title="Desativar usuário"
        message={`${desativando?.nome ?? ""} perderá o acesso ao sistema imediatamente. Os vínculos ficam guardados para uma futura reativação.`}
        confirmLabel="Desativar"
        loading={loadingAtivo}
        onConfirm={() => desativando && alterarAtivo(desativando, false)}
        onCancel={() => setDesativando(null)}
      />
    </div>
  );
}
