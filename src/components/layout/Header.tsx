"use client";

import { Menu, Sun, Moon, Building2 } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useEmpresa } from "@/context/EmpresaContext";

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { theme, toggle } = useTheme();
  const { empresas, empresaId, setEmpresaId } = useEmpresa();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 shadow-sm transition-colors">
      <button
        onClick={onMenuClick}
        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-gray-100 dark:hover:bg-slate-700 lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu size={22} />
      </button>

      {/* Empresa em que o portal está posicionado (só aparece com mais de uma). */}
      {empresas.length > 1 && (
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-[var(--text-muted)]" />
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(Number(e.target.value))}
            title="Empresa"
            className="max-w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-semibold text-[var(--text)]"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.codigo}</option>
            ))}
          </select>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggle}
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          aria-label="Alternar tema"
        >
          {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
    </header>
  );
}
