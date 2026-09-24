"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REGRAS, STATUS, formatReais, mesDe, rotuloMes,
  type Bloco, type Lancamento, type Status,
} from "@/lib/fluxo-caixa";

interface Props {
  blocos: Bloco[];
  lancamentos: Lancamento[];
  filiais: { cd: number; nome: string }[];
  onAbrir: (l: Lancamento) => void;
}

// Cor do status: o que ainda é intenção fica neutro; o que já é compromisso ganha cor.
const COR_STATUS: Record<Status, string> = {
  previsto: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200",
  aprovado: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200",
  contratado: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200",
  realizado: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200",
  cancelado: "bg-red-100 text-red-700 line-through dark:bg-red-900/40 dark:text-red-200",
};

const normalizar = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export default function ListaLancamentos({ blocos, lancamentos, filiais, onAbrir }: Props) {
  const [busca, setBusca] = useState("");
  const [bloco, setBloco] = useState("");
  const [status, setStatus] = useState<"ativos" | "todos" | Status>("ativos");
  const [unidade, setUnidade] = useState("");

  const nomeBloco = useMemo(() => new Map(blocos.map((b) => [b.id, b.nome])), [blocos]);
  const nomeFilial = useMemo(() => new Map(filiais.map((f) => [f.cd, f.nome])), [filiais]);
  const unidadesUsadas = useMemo(
    () => [...new Set(lancamentos.map((l) => l.unidade).filter((u): u is number => u != null))].sort((a, b) => a - b),
    [lancamentos]
  );

  const filtrados = useMemo(() => {
    const t = normalizar(busca.trim());
    return lancamentos.filter((l) =>
      (!t || normalizar(`${l.descricao} ${l.responsavel ?? ""} ${l.unidade ?? ""}`).includes(t)) &&
      (!bloco || l.bloco_id === bloco) &&
      (status === "todos" || (status === "ativos" ? l.status !== "cancelado" : l.status === status)) &&
      (!unidade || (unidade === "corp" ? l.unidade == null : l.unidade === Number(unidade)))
    );
  }, [lancamentos, busca, bloco, status, unidade]);

  const totalFiltrado = filtrados
    .filter((l) => l.status !== "cancelado")
    .reduce((s, l) => s + l.parcelas.reduce((a, p) => a + p.valor, 0), 0);

  const sel = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input id="fc-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição, responsável…"
            className="w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-7 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]" />
          {busca && (
            <button onClick={() => setBusca("")} title="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]">
              <X size={13} />
            </button>
          )}
        </div>
        <select id="fc-bloco" value={bloco} onChange={(e) => setBloco(e.target.value)} className={sel}>
          <option value="">Todos os blocos</option>
          {blocos.map((b) => <option key={b.id} value={b.id}>{b.pai_id ? `  · ${b.nome}` : b.nome}</option>)}
        </select>
        <select id="fc-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={sel}>
          <option value="ativos">Ativos (sem cancelados)</option>
          <option value="todos">Todos os status</option>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
        </select>
        <select id="fc-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} className={sel}>
          <option value="">Todas as unidades</option>
          <option value="corp">Corporativo (sem unidade)</option>
          {unidadesUsadas.map((u) => <option key={u} value={u}>{u} · {nomeFilial.get(u) ?? ""}</option>)}
        </select>
        <p className="ml-auto text-xs text-[var(--text-muted)]">
          {filtrados.length} lançamento{filtrados.length !== 1 ? "s" : ""} · total R$ <b className="tabular-nums text-[var(--text)]">{formatReais(totalFiltrado)}</b>
        </p>
      </div>

      <div className="max-h-[calc(100vh-17rem)] min-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-white">
              {["Descrição", "Bloco", "Unidade", "Status", "Responsável", "Regra", "Total (R$)", "Parcelas"].map((h, i) => (
                <th key={h} style={{ backgroundColor: "#0000C2" }}
                  className={cn("sticky top-0 z-10 whitespace-nowrap px-3 py-2 font-semibold", i === 6 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-[var(--text-muted)]">Nenhum lançamento com esses filtros.</td></tr>
            ) : filtrados.map((l, i) => {
              const total = l.parcelas.reduce((a, p) => a + p.valor, 0);
              const primeira = l.parcelas[0], ultima = l.parcelas[l.parcelas.length - 1];
              return (
                <tr key={l.id} onClick={() => onAbrir(l)}
                  className={cn("cursor-pointer border-t border-[var(--border)] hover:bg-[#EDEDFA] dark:hover:bg-[#191934]",
                    i % 2 === 1 && "bg-[#F1F2F6] dark:bg-neutral-800")}>
                  <td className="max-w-[26rem] px-3 py-2">
                    <div className="truncate font-semibold text-[var(--text)]" title={l.descricao}>{l.descricao}</div>
                    {l.origem && <div className="truncate text-[10px] text-[var(--text-muted)]">{l.origem}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{nomeBloco.get(l.bloco_id) ?? l.bloco_id}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{l.unidade ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", COR_STATUS[l.status])}>
                      {STATUS.find((s) => s.id === l.status)?.rotulo}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{l.responsavel ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{REGRAS.find((r) => r.id === l.regra)?.rotulo}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums",
                    total > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--text)]")}>
                    {l.parcelas.length ? formatReais(total) : "–"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">
                    {l.parcelas.length === 0 ? "—" : l.parcelas.length === 1
                      ? rotuloMes(mesDe(primeira.vencimento))
                      : `${l.parcelas.length}x · ${rotuloMes(mesDe(primeira.vencimento))} a ${rotuloMes(mesDe(ultima.vencimento))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
