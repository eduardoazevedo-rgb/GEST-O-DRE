"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MESES_CURTO } from "@/lib/labels";

/** Seletor de meses (multi): nenhum marcado = ano todo. Usado na DRE e em Custos. */
export default function SeletorMeses({ sel, onChange }: { sel: number[]; onChange: (v: number[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [aberto]);

  const alternar = (m: number) => onChange(sel.includes(m) ? sel.filter((x) => x !== m) : [...sel, m]);
  const rotulo = sel.length === 0 ? "Ano todo" : sel.length === 1 ? MESES_CURTO[sel[0]] : `${sel.length} meses`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
      >
        {rotulo}
        <ChevronDown size={14} className="text-[var(--text-muted)]" />
      </button>
      {aberto && (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {MESES_CURTO.map((m, i) => (
              <label key={m} className="flex cursor-pointer select-none items-center gap-1.5 rounded px-1 py-0.5 text-sm text-[var(--text)] hover:bg-[var(--bg)]">
                <input
                  type="checkbox"
                  checked={sel.includes(i)}
                  onChange={() => alternar(i)}
                  className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--primary)]"
                />
                {m}
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2">
            <button type="button" onClick={() => onChange([])} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">Ano todo</button>
            <button type="button" onClick={() => onChange([...Array(12).keys()])} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">Marcar todos</button>
          </div>
        </div>
      )}
    </div>
  );
}
