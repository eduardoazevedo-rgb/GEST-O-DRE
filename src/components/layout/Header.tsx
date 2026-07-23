"use client";

import { Menu, Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 shadow-sm transition-colors">
      <button
        onClick={onMenuClick}
        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-gray-100 dark:hover:bg-slate-700 lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu size={22} />
      </button>

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
