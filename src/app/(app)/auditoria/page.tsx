"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";
import { MESES_CURTO, formatNumero } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";

interface Ajuste {
  ano: number; mes: number; cd_empresa: number | null;
  cd_item: number | null; ds_item: string | null;
  ds_secao: string | null; ds_historico: string | null; tp_operacao: string | null;
  qtd: number; vl: number;
}
type Metrica = "vl" | "qtd";
interface No { key: string; nome: string; codigo?: string; qtd: number[]; vl: number[]; filhos: No[] }

const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

export default function AuditoriaPage() {
  const anoAtual = new Date().getFullYear();
  const supabase = useMemo(() => createClient(), []);
  const [ano, setAno] = useState(anoAtual);
  const [metrica, setMetrica] = useState<Metrica>("vl");
  const [dados, setDados] = useState<Ajuste[]>([]);
  const [filiais, setFiliais] = useState<Map<number, string>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [fUnidade, setFUnidade] = useState<number | "">("");
  const [fHistorico, setFHistorico] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) => setAbertos((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const tudo: Ajuste[] = [];
    for (let de = 0; ; de += 1000) {
      const { data } = await supabase
        .from("ajustes_inventario")
        .select("mes,cd_empresa,cd_item,ds_item,ds_secao,ds_historico,tp_operacao,qtd,vl")
        .eq("ano", ano).range(de, de + 999);
      const lote = (data ?? []) as Ajuste[];
      tudo.push(...lote);
      if (lote.length < 1000) break;
    }
    setDados(tudo);
    const { data: fil } = await supabase.from("filiais").select("cd_empresa,nome");
    setFiliais(new Map((fil ?? []).map((f: { cd_empresa: number; nome: string }) => [f.cd_empresa, f.nome])));
    setAbertos(new Set());
    setCarregando(false);
  }, [supabase, ano]);
  useEffect(() => { carregar(); }, [carregar]);

  const filialNome = (cd: number | null) => (cd == null ? "—" : `${cd} · ${filiais.get(cd) ?? ""}`.trim());
  const val = (n: No) => n[metrica];

  const unidades = useMemo(() => [...new Set(dados.map((d) => d.cd_empresa).filter((v): v is number => v != null))].sort((a, b) => a - b), [dados]);
  const historicos = useMemo(() => [...new Set(dados.map((d) => d.ds_historico).filter(Boolean) as string[])].sort(), [dados]);

  const filtrado = useMemo(() => dados.filter((d) =>
    (fUnidade === "" || d.cd_empresa === fUnidade) && (!fHistorico || d.ds_historico === fHistorico) && (!fTipo || d.tp_operacao === fTipo)
  ), [dados, fUnidade, fHistorico, fTipo]);

  // KPIs
  const kpis = useMemo(() => {
    let total = 0, ent = 0, sai = 0;
    for (const d of filtrado) { const m = d[metrica]; total += m; if (d.tp_operacao === "E") ent += m; else sai += m; }
    return { total, ent, sai, n: filtrado.length };
  }, [filtrado, metrica]);

  const porMes = useMemo(() => MESES_CURTO.map((mes, i) => ({
    mes, valor: filtrado.filter((d) => d.mes === i + 1).reduce((a, d) => a + d[metrica], 0),
  })), [filtrado, metrica]);

  // Árvore Unidade → Seção → Item
  const arvore = useMemo(() => {
    const z = () => Array(12).fill(0) as number[];
    type Bruto = { key: string; nome: string; codigo?: string; qtd: number[]; vl: number[]; filhos: Map<string, Bruto> };
    const raiz = new Map<string, Bruto>();
    const get = (m: Map<string, Bruto>, key: string, nome: string, codigo?: string) => {
      let n = m.get(key); if (!n) { n = { key, nome, codigo, qtd: z(), vl: z(), filhos: new Map() }; m.set(key, n); } return n;
    };
    for (const d of filtrado) {
      const i = d.mes - 1;
      const e = get(raiz, `e${d.cd_empresa}`, filialNome(d.cd_empresa), String(d.cd_empresa ?? ""));
      e.qtd[i] += d.qtd; e.vl[i] += d.vl;
      const s = get(e.filhos, `s${d.ds_secao ?? "—"}`, d.ds_secao ?? "—");
      s.qtd[i] += d.qtd; s.vl[i] += d.vl;
      const it = get(s.filhos, `i${d.cd_item ?? d.ds_item}`, d.ds_item ?? String(d.cd_item ?? "—"), d.cd_item ? String(d.cd_item) : undefined);
      it.qtd[i] += d.qtd; it.vl[i] += d.vl;
    }
    const conv = (m: Map<string, Bruto>): No[] => [...m.values()]
      .map((b) => ({ key: b.key, nome: b.nome, codigo: b.codigo, qtd: b.qtd, vl: b.vl, filhos: conv(b.filhos) }))
      .sort((a, b) => Math.abs(soma(b[metrica])) - Math.abs(soma(a[metrica])));
    return conv(raiz);
  }, [filtrado, metrica, filiais]);

  const topItens = useMemo(() => {
    const m = new Map<string, { nome: string; v: number }>();
    for (const d of filtrado) { const k = d.ds_item ?? String(d.cd_item); const cur = m.get(k) ?? { nome: k, v: 0 }; cur.v += d[metrica]; m.set(k, cur); }
    return [...m.values()].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 12);
  }, [filtrado, metrica]);

  const fmt = (v: number) => (v === 0 ? "–" : formatNumero(v));
  const cor = (v: number) => (v > 0 ? "text-emerald-600 dark:text-emerald-400" : v < 0 ? "text-red-600 dark:text-red-400" : "text-[var(--text-muted)]/50");

  // Render da árvore
  function renderNo(no: No, depth: number, out: ReactNode[]) {
    const aberto = abertos.has(no.key);
    const arr = no[metrica];
    const t = soma(arr);
    const bg = depth === 0 ? "font-bold" : depth === 1 ? "font-semibold" : "";
    out.push(
      <tr key={no.key} className={cn("border-t border-[var(--border)] hover:bg-[var(--bg)]", bg)}>
        <td className="sticky left-0 z-10 whitespace-nowrap pr-3 bg-[var(--surface)]"
          style={{ paddingLeft: `${12 + depth * 16}px` }}>
          <button onClick={() => no.filhos.length && alternar(no.key)}
            className={cn("flex items-center gap-1 py-1.5 text-left", no.filhos.length ? "cursor-pointer" : "cursor-default")}>
            {no.filhos.length ? (aberto ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />) : <span className="inline-block w-[13px] shrink-0" />}
            <span className={cn(depth === 2 && "text-[var(--text-muted)]")}>
              {no.codigo && depth < 2 && <span className="text-[var(--text-muted)] mr-1">{no.codigo}</span>}
              {no.nome}
            </span>
          </button>
        </td>
        {arr.map((v, i) => <td key={i} className={cn("px-2 py-1.5 text-right tabular-nums", cor(v))}>{fmt(v)}</td>)}
        <td className={cn("border-l border-[var(--border)] px-2 py-1.5 text-right tabular-nums font-bold", cor(t))}>{fmt(t)}</td>
      </tr>
    );
    if (aberto) for (const f of no.filhos) renderNo(f, depth + 1, out);
  }
  const linhas: ReactNode[] = [];
  for (const n of arvore) renderNo(n, 0, linhas);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Auditoria — Ajustes de Inventário</h1>
          <p className="text-xs text-[var(--text-muted)]">Entradas e saídas por inventário (ops. 998/999) · valor e quantidade</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {(["vl", "qtd"] as const).map((m) => (
              <button key={m} onClick={() => setMetrica(m)}
                className={cn("rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                  metrica === m ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}>
                {m === "vl" ? "Valor (R$)" : "Quantidade"}
              </button>
            ))}
          </div>
          <select value={fUnidade} onChange={(e) => setFUnidade(e.target.value === "" ? "" : Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
            <option value="">Todas as unidades</option>
            {unidades.map((u) => <option key={u} value={u}>{u} · {filiais.get(u) ?? ""}</option>)}
          </select>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
            <option value="">Entradas e saídas</option>
            <option value="E">Só entradas</option>
            <option value="S">Só saídas</option>
          </select>
          <select value={fHistorico} onChange={(e) => setFHistorico(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] max-w-44">
            <option value="">Todos os históricos</option>
            {historicos.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
            {Array.from({ length: 6 }, (_, i) => anoAtual + 1 - i).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={carregar} title="Recarregar"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-muted)] hover:text-[var(--text)]">
            <RefreshCw size={16} className={cn(carregando && "animate-spin")} />
          </button>
        </div>
      </div>

      {carregando ? (
        <p className="py-16 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
      ) : dados.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Nenhum ajuste de inventário para {ano}.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Ajuste líquido" valor={fmt(kpis.total)} cor={cor(kpis.total)} />
            <Kpi titulo="Entradas" valor={fmt(kpis.ent)} cor="text-emerald-600 dark:text-emerald-400" />
            <Kpi titulo="Saídas" valor={fmt(kpis.sai)} cor="text-red-600 dark:text-red-400" />
            <Kpi titulo="Lançamentos" valor={kpis.n.toLocaleString("pt-BR")} />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Acompanhamento mensal · {metrica === "vl" ? "valor" : "quantidade"}</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porMes} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumero(v)} width={80} />
                  <Tooltip formatter={(v) => formatNumero(Number(v))} />
                  <ReferenceLine y={0} stroke="var(--text-muted)" strokeOpacity={0.4} />
                  <Bar dataKey="valor" radius={[3, 3, 0, 0]}>
                    {porMes.map((d, i) => <Cell key={i} fill={d.valor >= 0 ? "#059669" : "#dc2626"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-[#0000C2] text-white">
                  <th className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-56">Unidade / Seção / Item</th>
                  {MESES_CURTO.map((m) => <th key={m} className="border-l border-white/20 px-2 py-1.5 text-right font-semibold">{m}</th>)}
                  <th className="border-l border-white/20 px-2 py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>{linhas}</tbody>
              {/* Totalizador do que está filtrado, no pé da tabela. */}
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-[var(--surface)] font-bold dark:border-slate-600">
                  <td className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-2 text-left uppercase tracking-wide text-[var(--text)]">
                    Total {metrica === "vl" ? "(R$)" : "(qtd)"}
                  </td>
                  {porMes.map((p, i) => (
                    <td key={i} className={cn("px-2 py-2 text-right tabular-nums", cor(p.valor))}>{fmt(p.valor)}</td>
                  ))}
                  <td className={cn("border-l border-[var(--border)] px-2 py-2 text-right tabular-nums", cor(kpis.total))}>
                    {fmt(kpis.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]"><h2 className="text-sm font-semibold text-[var(--text)]">Itens com maior ajuste ({metrica === "vl" ? "valor" : "quantidade"})</h2></div>
            <div className="divide-y divide-[var(--border)]">
              {topItens.map((it) => (
                <div key={it.nome} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                  <span className="truncate text-[var(--text)]" title={it.nome}>{it.nome}</span>
                  <span className={cn("tabular-nums font-semibold shrink-0", cor(it.v))}>{fmt(it.v)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ titulo, valor, cor }: { titulo: string; valor: string; cor?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{titulo}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", cor ?? "text-[var(--text)]")}>{valor}</p>
    </div>
  );
}
