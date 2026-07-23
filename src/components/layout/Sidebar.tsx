"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Table2,
  Target,
  ListTree,
  RefreshCw,
  UserCog,
  LogOut,
  Gauge,
  Receipt,
  Plane,
  ClipboardCheck,
  KeyRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { userRoleLabel } from "@/lib/labels";
import { useAuth } from "@/context/AuthContext";
import AlterarSenhaModal from "@/components/AlterarSenhaModal";

const navItems = [
  { href: "/executivo", label: "Executivo", icon: Gauge },
  { href: "/dre", label: "DRE", icon: Table2 },
  { href: "/custos", label: "Análise de custos", icon: Receipt },
  { href: "/viagens", label: "Custo de Viagens", icon: Plane, viagensOnly: true },
  { href: "/auditoria", label: "Auditoria", icon: ClipboardCheck, auditoriaOnly: true },
  { href: "/orcamento", label: "Orçamento", icon: Target },
  { href: "/plano-contas", label: "Plano de Contas", icon: ListTree, adminOnly: true },
  { href: "/sincronizacao", label: "Sincronização", icon: RefreshCw, adminOnly: true },
  { href: "/usuarios", label: "Usuários", icon: UserCog, adminOnly: true },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, isAdmin, podeVerViagens, podeVerAuditoria, signOut } = useAuth();
  const [senhaAberta, setSenhaAberta] = useState(false);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-[var(--surface)] text-[var(--text)] border-r border-[var(--border)] transition-transform duration-300 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="bg-[var(--primary)] text-white p-2">
              <BarChart3 size={22} />
            </div>
            <div className="leading-tight">
              <span className="block text-base font-bold tracking-tight uppercase">Portal Hoff</span>
              <span className="block text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Controladoria</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.filter(item => (!("adminOnly" in item && item.adminOnly) || isAdmin) && (!("viagensOnly" in item && item.viagensOnly) || podeVerViagens) && (!("auditoriaOnly" in item && item.auditoriaOnly) || podeVerAuditoria)).map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 text-sm font-semibold uppercase tracking-wide transition-colors border-l-2",
                  active
                    ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--bg)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]"
                )}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Perfil + sair */}
        <div className="border-t border-[var(--border)] px-4 py-4">
          <div className="mb-3">
            <p className="text-sm font-semibold text-[var(--text)] truncate">
              {profile?.nome ?? "Carregando..."}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {profile ? userRoleLabel[profile.role] : ""}
            </p>
          </div>
          <button
            onClick={() => setSenhaAberta(true)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-black dark:hover:text-white transition-colors"
          >
            <KeyRound size={16} />
            Alterar senha
          </button>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-black dark:hover:text-white transition-colors"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {senhaAberta && <AlterarSenhaModal onClose={() => setSenhaAberta(false)} />}
    </>
  );
}
