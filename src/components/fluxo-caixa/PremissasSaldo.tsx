"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import {
  formatReais, lerValor, listarMeses, mesDe, rotuloMes, somarMeses,
  type Lancamento, type Premissa, type SaldoReal,
} from "@/lib/fluxo-caixa";

interface Props {
  empresaId: number;
  premissas: Premissa[];
  saldos: SaldoReal[];
  lancamentos: Lancamento[];
  podeEditar: boolean;
  onSalvo: () => void;
}

type Linha = "clientes" | "fornecedores" | "saldo";
const LINHAS: { id: Linha; rotulo: string; ajuda: string }[] = [
  { id: "clientes", rotulo: "Clientes (média)", ajuda: "Entrada — gravada como positiva" },
  { id: "fornecedores", rotulo: "Fornecedores (média)", ajuda: "Saída — gravada como negativa" },
  { id: "saldo", rotulo: "Saldo real (fim do mês)", ajuda: "Posição do banco no último dia do mês" },
];

const chave = (linha: Linha, mes: string) => `${linha}|${mes}`;
const exibir = (v: number) => formatReais(v, Number.isInteger(v) ? 0 : 2);

export default function PremissasSaldo({ empresaId, premissas, saldos, lancamentos, podeEditar, onSalvo }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();

  const originais = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of premissas) m.set(chave(p.tipo, p.mes), p.valor);
    for (const s of saldos) m.set(chave("saldo", s.mes), s.valor);
    return m;
  }, [premissas, saldos]);

  const mesesComDado = useMemo(() => {
    const s = new Set<string>();
    for (const p of premissas) s.add(p.mes);
    for (const r of saldos) s.add(r.mes);
    for (const l of lancamentos) for (const p of l.parcelas) s.add(mesDe(p.vencimento));
    return [...s].sort();
  }, [premissas, saldos, lancamentos]);

  const inicioAno = `${new Date().getFullYear()}-01-01`;
  const primeiro = mesesComDado[0] && mesesComDado[0] < inicioAno ? mesesComDado[0] : inicioAno;
  const ultimo = mesesComDado[mesesComDado.length - 1] ?? somarMeses(inicioAno, 11);
  const opcoes = listarMeses(primeiro, somarMeses(ultimo > inicioAno ? ultimo : inicioAno, 12));

  const [de, setDe] = useState(primeiro);
  const [ate, setAte] = useState(ultimo > somarMeses(inicioAno, 11) ? ultimo : somarMeses(inicioAno, 11));
  const [edicoes, setEdicoes] = useState<Map<string, string>>(new Map());
  const [salvando, setSalvando] = useState(false);

  const meses = de <= ate ? listarMeses(de, ate) : [];

  const texto = (linha: Linha, mes: string) => {
    const k = chave(linha, mes);
    if (edicoes.has(k)) return edicoes.get(k)!;
    const v = originais.get(k);
    return v == null ? "" : exibir(v);
  };

  // Só conta como alteração o que de fato mudou o valor gravado.
  const alterados = [...edicoes.entries()].filter(([k, t]) => {
    const novo = lerValor(t);
    const antigo = originais.get(k) ?? null;
    const [linha] = k.split("|") as [Linha];
    const ajustado = novo == null ? null : linha === "fornecedores" ? -Math.abs(novo) : linha === "clientes" ? Math.abs(novo) : novo;
    return ajustado !== antigo;
  });

  async function salvar() {
    setSalvando(true);
    try {
      for (const [k, t] of alterados) {
        const [linha, mes] = k.split("|") as [Linha, string];
        const v = lerValor(t);
        if (linha === "saldo") {
          const r = v == null
            ? await supabase.from("fc_saldos_reais").delete().eq("empresa_id", empresaId).eq("mes", mes)
            : await supabase.from("fc_saldos_reais").upsert({ empresa_id: empresaId, mes, valor: v, informado_em: new Date().toISOString() }, { onConflict: "empresa_id,mes" });
          if (r.error) throw new Error(r.error.message);
        } else {
          const valor = v == null ? null : linha === "fornecedores" ? -Math.abs(v) : Math.abs(v);
          const r = valor == null
            ? await supabase.from("fc_premissas").delete().eq("empresa_id", empresaId).eq("mes", mes).eq("tipo", linha)
            : await supabase.from("fc_premissas").upsert({ empresa_id: empresaId, mes, tipo: linha, valor, atualizado_em: new Date().toISOString() }, { onConflict: "empresa_id,mes,tipo" });
          if (r.error) throw new Error(r.error.message);
        }
      }
      toast(`${alterados.length} valor${alterados.length !== 1 ? "es" : ""} salvo${alterados.length !== 1 ? "s" : ""}.`);
      setEdicoes(new Map());
      onSalvo();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSalvando(false);
    }
  }

  const sel = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="pr-de">De</label>
        <select id="pr-de" value={de} onChange={(e) => setDe(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <label className="text-xs text-[var(--text-muted)]" htmlFor="pr-ate">até</label>
        <select id="pr-ate" value={ate} onChange={(e) => setAte(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>

        {podeEditar ? (
          <div className="ml-auto flex items-center gap-2">
            {alterados.length > 0 && (
              <>
                <span className="text-xs text-[var(--text-muted)]">{alterados.length} alteraç{alterados.length !== 1 ? "ões" : "ão"} não salva{alterados.length !== 1 ? "s" : ""}</span>
                <button onClick={() => setEdicoes(new Map())} disabled={salvando}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)]">Descartar</button>
              </>
            )}
            <button onClick={salvar} disabled={salvando || alterados.length === 0}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              {salvando ? "Salvando…" : "Salvar"}
            </button>
          </div>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <Lock size={12} /> Só administradores editam premissas e saldo real
          </span>
        )}
      </div>

      {meses.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">O mês inicial precisa ser anterior ao final.</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-white">
                <th style={{ backgroundColor: "#0000C2" }} className="sticky left-0 z-20 min-w-60 px-3 py-2 text-left font-semibold">Premissa · R$</th>
                {meses.map((m) => (
                  <th key={m} style={{ backgroundColor: "#0000C2" }} className="border-l border-white/20 px-2 py-2 text-right font-semibold">{rotuloMes(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LINHAS.map((linha, i) => (
                <tr key={linha.id} className={cn("border-t border-[var(--border)]", i === 2 && "border-t-2 border-slate-300 dark:border-slate-600")}>
                  <td className={cn("sticky left-0 z-10 px-3 py-2 shadow-[2px_0_4px_rgba(0,0,0,0.05)]", i % 2 === 1 ? "bg-[#F1F2F6] dark:bg-neutral-800" : "bg-[var(--surface)]")}>
                    <div className="font-bold text-[var(--text)]">{linha.rotulo}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{linha.ajuda}</div>
                  </td>
                  {meses.map((m) => {
                    const k = chave(linha.id, m);
                    const editado = edicoes.has(k) && alterados.some(([ka]) => ka === k);
                    return (
                      <td key={m} className={cn("px-1 py-1", i % 2 === 1 && "bg-[#F1F2F6] dark:bg-neutral-800")}>
                        {podeEditar ? (
                          <input
                            aria-label={`${linha.rotulo} em ${rotuloMes(m)}`}
                            inputMode="decimal"
                            value={texto(linha.id, m)}
                            onChange={(e) => setEdicoes((prev) => new Map(prev).set(k, e.target.value))}
                            onBlur={(e) => {
                              const v = lerValor(e.target.value);
                              if (v != null) setEdicoes((prev) => new Map(prev).set(k, exibir(linha.id === "fornecedores" ? -Math.abs(v) : linha.id === "clientes" ? Math.abs(v) : v)));
                            }}
                            className={cn(
                              "w-28 rounded-md border bg-[var(--surface)] px-2 py-1 text-right tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40",
                              editado ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20" : "border-transparent hover:border-[var(--border)]"
                            )}
                          />
                        ) : (
                          <div className="w-28 px-2 py-1 text-right tabular-nums">{texto(linha.id, m) || <span className="text-[var(--text-muted)]/40">–</span>}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        Valores em reais. Apague o conteúdo de uma célula para remover o valor daquele mês. O saldo real de um mês passa a ser o saldo inicial do mês seguinte na Visão.
      </p>
    </div>
  );
}
