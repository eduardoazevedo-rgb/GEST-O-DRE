"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Dices, Copy, CheckCircle2 } from "lucide-react";
import { userRoleOptions } from "@/lib/labels";
import { MODULOS, MODULOS_PADRAO, type ModuloId } from "@/lib/modulos";
import { useToast } from "@/context/ToastContext";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

function gerarSenha(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function CriarUsuarioForm() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState("gestor");
  const [modulos, setModulos] = useState<ModuloId[]>([...MODULOS_PADRAO]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [criado, setCriado] = useState<{ email: string; senha: string } | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = "Nome obrigatório";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "E-mail inválido";
    if (senha.length < 6) e.senha = "Senha deve ter ao menos 6 caracteres";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    setCriado(null);

    try {
      const res = await fetch("/api/usuarios/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), email: email.trim(), senha, role, modulos }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Erro ao criar usuário", "error");
        setLoading(false);
        return;
      }
      setCriado({ email: email.trim(), senha });
      toast("Usuário criado!");
      setNome(""); setEmail(""); setSenha(""); setRole("gestor"); setModulos([...MODULOS_PADRAO]); setErrors({});
      router.refresh();
    } catch {
      toast("Erro de conexão com o servidor", "error");
    } finally {
      setLoading(false);
    }
  }

  function copiarCredenciais() {
    if (!criado) return;
    navigator.clipboard.writeText(`E-mail: ${criado.email}\nSenha: ${criado.senha}`);
    toast("Credenciais copiadas!");
  }

  return (
    <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <UserPlus size={16} className="text-blue-600" />
        <h2 className="text-sm font-semibold text-[var(--text)]">Cadastrar novo usuário</h2>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Nome completo *" placeholder="Maria da Silva" value={nome}
          onChange={e => { setNome(e.target.value); setErrors(er => ({ ...er, nome: "" })); }} error={errors.nome} />
        <Input label="E-mail *" type="email" placeholder="usuario@empresa.com" value={email}
          onChange={e => { setEmail(e.target.value); setErrors(er => ({ ...er, email: "" })); }} error={errors.email} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Senha *</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Mínimo 6 caracteres"
              value={senha}
              onChange={e => { setSenha(e.target.value); setErrors(er => ({ ...er, senha: "" })); }}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-mono transition-colors
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                bg-[var(--surface)] text-[var(--text)]
                ${errors.senha ? "border-red-400 bg-red-50 dark:bg-red-900/20" : "border-[var(--border)] hover:border-gray-400"}`}
            />
            <button
              type="button"
              onClick={() => { setSenha(gerarSenha()); setErrors(er => ({ ...er, senha: "" })); }}
              title="Gerar senha aleatória"
              className="shrink-0 px-3 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--border)] transition-colors"
            >
              <Dices size={16} />
            </button>
          </div>
          {errors.senha && <p className="text-xs text-red-600">{errors.senha}</p>}
        </div>

        <Select label="Perfil *" value={role} onChange={e => setRole(e.target.value)} options={userRoleOptions} />

        <div className="sm:col-span-2">
          {role === "admin" ? (
            <p className="text-xs text-[var(--text-muted)]">Administradores enxergam todos os módulos.</p>
          ) : (
            <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Módulos liberados</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {MODULOS.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none">
                    <input type="checkbox" checked={modulos.includes(m.id)}
                      onChange={(e) => setModulos((prev) => e.target.checked ? [...prev.filter(x => x !== m.id), m.id] : prev.filter(x => x !== m.id))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]" />
                    {m.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Dá pra ajustar depois em Editar. Unidades e contas continuam nos Vínculos.
              </p>
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <Button type="submit" loading={loading}>Cadastrar usuário</Button>
        </div>
      </form>

      {criado && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-sm">
            <p className="font-medium text-[var(--text)]">Usuário criado — repasse as credenciais:</p>
            <p className="text-[var(--text-muted)] font-mono">{criado.email} · {criado.senha}</p>
          </div>
          <button onClick={copiarCredenciais} className="text-xs text-blue-600 hover:underline flex items-center gap-1 shrink-0">
            <Copy size={13} /> Copiar
          </button>
        </div>
      )}
    </div>
  );
}
