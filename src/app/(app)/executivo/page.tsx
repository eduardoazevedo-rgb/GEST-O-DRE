"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";
import { MESES_CURTO, formatNumero, formatPct } from "@/lib/labels";
import { kpisTopo, ponteResultado, valorPeriodo, ultimoMesComDado, margensNaturezaYoY, type Periodo, type KpiTriplo } from "@/lib/executivo";
import { buscarDre, dreEmCache } from "@/lib/dre-fetch";
import { useEmpresa } from "@/context/EmpresaContext";
import type { DreResposta, DreLinha } from "@/lib/types";
import PonteResultado from "@/components/executivo/PonteResultado";

export default function ExecutivoPage() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [dre, setDre] = useState<DreResposta | null>(null);
  const [anterior, setAnterior] = useState<DreResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [modo, setModo] = useState<"mes" | "ytd">("ytd");
  const [mes, setMes] = useState<number>(new Date().getMonth());
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [contaAnalise, setContaAnalise] = useState("RESULTADO");
  const [blocoChart, setBlocoChart] = useState<"merc" | "serv">("merc");

  const { empresaId } = useEmpresa();

  const carregar = useCallback(async () => {
    const cache = dreEmCache(ano, null, empresaId);
    if (cache) { setDre(cache); setMes(ultimoMesComDado(cache)); setCarregando(false); } else setCarregando(true);
    setErro("");
    try {
      const [j1, j3] = await Promise.all([
        buscarDre(ano, null, empresaId),
        buscarDre(ano - 1, null, empresaId).catch(() => null),
      ]);
      setDre(j1);
      setAnterior(j3);
      setMes(ultimoMesComDado(j1));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [ano, empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const periodo: Periodo = useMemo(() => ({ modo, mes }), [modo, mes]);
  const kpis = useMemo(() => (dre ? kpisTopo(dre, null, periodo) : []), [dre, periodo]);
  const passos = useMemo(() => (dre ? ponteResultado(dre, periodo) : []), [dre, periodo]);

  function alternar(codigo: string) {
    setAbertos((prev) => {
      const novo = new Set(prev);
      if (novo.has(codigo)) novo.delete(codigo); else novo.add(codigo);
      return novo;
    });
  }

  // Linhas visíveis da DRE (mesma estrutura/roll-up da tela DRE): N2 sempre visível;
  // filhos aparecem se todos os ancestrais estiverem abertos.
  const visiveis = useMemo(() => {
    if (!dre) return [] as DreLinha[];
    return dre.linhas.filter((l) => {
      if (l.nivel <= 2) return true;
      const partes = l.codigo.split(".");
      for (let n = 2; n < partes.length; n++) {
        if (!abertos.has(partes.slice(0, n).join("."))) return false;
      }
      return true;
    });
  }, [dre, abertos]);

  const receitaBase = useMemo(() => {
    const l = dre?.linhas.find((x) => x.codigo === "3.1");
    return l ? valorPeriodo(l.realizado, periodo) : 0;
  }, [dre, periodo]);

  const resultado = useMemo(() => {
    if (!dre) return { realizado: 0, planejado: 0 };
    const n2 = dre.linhas.filter((l) => l.nivel === 2);
    return {
      realizado: n2.reduce((a, l) => a + valorPeriodo(l.realizado, periodo), 0),
      planejado: n2.reduce((a, l) => a + valorPeriodo(l.planejado, periodo), 0),
    };
  }, [dre, periodo]);

  const margens = useMemo(() => (dre ? margensNaturezaYoY(dre, anterior, periodo) : []), [dre, anterior, periodo]);
  const serieChart = useMemo(() => margens.find((m) => m.chave === blocoChart)?.serie ?? [], [margens, blocoChart]);

  const rotuloPeriodo = modo === "mes" ? MESES_CURTO[mes] : `Acum. até ${MESES_CURTO[mes]}`;

  // Análise anual (realizado, ano cheio × ano anterior) — independente do filtro Mês/Acum.
  const contasN2 = useMemo(() => (dre?.linhas ?? []).filter((l) => l.nivel === 2), [dre]);
  const serieMensal = useCallback((dados: DreResposta | null): number[] => {
    if (!dados) return Array(12).fill(0);
    if (contaAnalise === "RESULTADO") {
      return Array.from({ length: 12 }, (_, m) =>
        dados.linhas.filter((l) => l.nivel === 2).reduce((a, l) => a + l.realizado[m], 0));
    }
    const l = dados.linhas.find((x) => x.codigo === contaAnalise);
    return l ? l.realizado : Array(12).fill(0);
  }, [contaAnalise]);

  const analise = useMemo(() => {
    const atualSerie = serieMensal(dre);
    const anteriorSerie = serieMensal(anterior);
    const totalAtual = atualSerie.reduce((a, b) => a + b, 0);
    const totalAnterior = anteriorSerie.reduce((a, b) => a + b, 0);
    const yoy = totalAnterior !== 0 ? ((totalAtual - totalAnterior) / Math.abs(totalAnterior)) * 100 : null;
    const mesesComDado = atualSerie.filter((v) => v !== 0).length || 1;
    const grafico = MESES_CURTO.map((m, i) => ({
      mes: m,
      [String(ano)]: Math.round(atualSerie[i]),
      [String(ano - 1)]: Math.round(anteriorSerie[i]),
    }));
    return { totalAtual, totalAnterior, yoy, media: totalAtual / mesesComDado, grafico };
  }, [dre, anterior, serieMensal, ano]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Painel Executivo</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {ano} · {rotuloPeriodo} · Realizado × Orçado
            {dre?.versaoNome ? ` · Orçamento: ${dre.versaoNome}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {(["ytd", "mes"] as const).map((m) => (
              <button key={m} onClick={() => setModo(m)}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  modo === m ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}>
                {m === "ytd" ? "Acumulado" : "Mês"}
              </button>
            ))}
          </div>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
            {MESES_CURTO.map((m, i) => <option key={m} value={i}>{m}</option>)}
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

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      {dre && !dre.versaoId && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Sem orçamento ativo para {ano} — comparativos com Orçado ficam zerados.
        </div>
      )}

      {carregando && !dre ? (
        <p className="py-16 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
      ) : dre ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {kpis.map((k) => <KpiCard key={k.chave} k={k} />)}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            {/* Estrutura da DRE (mesma da tela DRE) com comparativo do período */}
            <div className="lg:col-span-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h2 className="text-sm font-semibold text-[var(--text)]">Demonstração de resultado</h2>
                <p className="text-xs text-[var(--text-muted)]">Estrutura da DRE · Orçado × Realizado · análise vertical (%RL)</p>
              </div>
              <TabelaDre
                linhas={visiveis} periodo={periodo} abertos={abertos} alternar={alternar}
                receitaBase={receitaBase} resultado={resultado}
              />
            </div>

            <div className="lg:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="text-sm font-semibold text-[var(--text)]">Ponte de resultado</h2>
              <p className="text-xs text-[var(--text-muted)] mb-2">Do lucro líquido orçado ao realizado</p>
              <PonteResultado passos={passos} />
            </div>
          </div>

          {/* Margem por natureza — Mercadorias × Serviços (receita × custo mensal) */}
          {margens.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text)]">Margem por natureza — Mercadorias × Serviços</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Receita líquida × custo direto · {ano} · se a receita cai, o custo deveria cair junto
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text)]">Receita × custo mês a mês — {ano}</h3>
                    <p className="text-xs text-[var(--text-muted)]">Barras: receita líquida e custo · linha: custo/receita (%)</p>
                  </div>
                  <div className="ml-auto flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
                    {margens.map((m) => (
                      <button key={m.chave} onClick={() => setBlocoChart(m.chave as "merc" | "serv")}
                        className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          blocoChart === m.chave ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}>
                        {m.titulo}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={serieChart} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                      <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumero(v)} width={90} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} />
                      <Tooltip formatter={(v, n) => (n === "Custo/Receita" ? `${Number(v).toFixed(1)}%` : formatNumero(Number(v)))} />
                      <Legend />
                      <Bar yAxisId="l" dataKey="receita" name="Receita líquida" fill="#0000C2" radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="l" dataKey="custo" name="Custo direto" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" dataKey="custoRec" name="Custo/Receita" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Tabela mensal com os números exatos do bloco selecionado */}
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-y border-[var(--border)] text-[var(--text-muted)]">
                        <th className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-left font-medium">R$</th>
                        {serieChart.map((d) => (
                          <th key={d.mes} className="px-2 py-1.5 text-right font-medium">{d.mes}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <LinhaSerie rotulo="Receita bruta" valores={serieChart.map((d) => d.bruta)} />
                      <LinhaSerie rotulo="(−) Devoluções" cor="text-[var(--text-muted)]" valores={serieChart.map((d) => d.devol)} />
                      <LinhaSerie rotulo="(−) Impostos" cor="text-[var(--text-muted)]" valores={serieChart.map((d) => d.impostos)} />
                      <LinhaSerie rotulo="= Receita líquida" cor="text-[#0000C2] dark:text-blue-400" valores={serieChart.map((d) => d.receita)} negrito />
                      <LinhaSerie rotulo="(−) Custo direto" cor="text-[var(--text-muted)]" valores={serieChart.map((d) => -d.custo)} />
                      <LinhaSerie rotulo="= Margem de contribuição" valores={serieChart.map((d) => d.receita - d.custo)} negrito />
                      <tr className="border-t border-[var(--border)]">
                        <td className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-left font-medium text-red-600 dark:text-red-400">Custo / Receita</td>
                        {serieChart.map((d) => (
                          <td key={d.mes} className="px-2 py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">
                            {d.custoRec != null ? formatPct(d.custoRec) : "–"}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Análise anual — Realizado (ano cheio × ano anterior) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text)]">Análise anual — Realizado</h2>
                <p className="text-xs text-[var(--text-muted)]">Ano cheio {ano} × {ano - 1} · realizado</p>
              </div>
              <select value={contaAnalise} onChange={(e) => setContaAnalise(e.target.value)}
                className="ml-auto max-w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                <option value="RESULTADO">RESULTADO (todas as contas)</option>
                {contasN2.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo}. {c.nome}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniCard titulo={`Total ${ano}`} valor={formatNumero(analise.totalAtual)} negativo={analise.totalAtual < 0} />
              <MiniCard titulo={`Total ${ano - 1}`} valor={formatNumero(analise.totalAnterior)} negativo={analise.totalAnterior < 0} />
              <MiniCard titulo="Crescimento YoY" valor={analise.yoy !== null ? formatPct(analise.yoy) : "–"} negativo={analise.yoy !== null && analise.yoy < 0} />
              <MiniCard titulo="Média mensal" valor={formatNumero(analise.media)} negativo={analise.totalAtual < 0} />
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Comparativo mensal {ano} vs {ano - 1}</h3>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analise.grafico} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                    <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumero(v)} width={90} />
                    <Tooltip formatter={(v) => formatNumero(Number(v))} />
                    <Legend />
                    <Bar dataKey={String(ano - 1)} fill="#94a3b8" radius={[3, 3, 0, 0]} />
                    <Bar dataKey={String(ano)} fill="#0000C2" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MiniCard({ titulo, valor, negativo }: { titulo: string; valor: string; negativo?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--text-muted)]">{titulo}</p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", negativo ? "text-red-600 dark:text-red-400" : "text-[var(--text)]")}>{valor}</p>
    </div>
  );
}

function LinhaSerie({ rotulo, valores, cor, negrito }: { rotulo: string; valores: number[]; cor?: string; negrito?: boolean }) {
  return (
    <tr className={cn("border-t border-[var(--border)]", negrito && "font-semibold")}>
      <td className={cn("sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-left", cor ?? "text-[var(--text)]")}>{rotulo}</td>
      {valores.map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right tabular-nums text-[var(--text)]">{v !== 0 ? formatNumero(v) : "–"}</td>
      ))}
    </tr>
  );
}

function KpiCard({ k }: { k: KpiTriplo }) {
  const fmt = (v: number) => (k.ehPercentual ? formatPct(v) : formatNumero(v));
  const Icon = k.favoravel ? TrendingUp : TrendingDown;
  const cor = k.favoravel ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{k.titulo}</p>
        <Icon size={16} className={cor} />
      </div>
      <p className={cn("mt-1.5 text-2xl font-bold tabular-nums text-[var(--text)]", k.realizado < 0 && !k.ehPercentual && "text-red-600 dark:text-red-400")}>
        {fmt(k.realizado)}
      </p>
      {k.margem != null && (
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">Margem {formatPct(k.margem)}</p>
      )}
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">Orçado {fmt(k.planejado)}</span>
        <span className={cn("font-semibold tabular-nums", cor)}>
          {k.deltaPlanAbs >= 0 ? "+" : ""}{fmt(k.deltaPlanAbs)}
          {k.deltaPlanPct !== null && ` (${k.deltaPlanPct >= 0 ? "+" : ""}${formatPct(k.deltaPlanPct)})`}
        </span>
      </div>
    </div>
  );
}

function TabelaDre({ linhas, periodo, abertos, alternar, receitaBase, resultado }: {
  linhas: DreLinha[];
  periodo: Periodo;
  abertos: Set<string>;
  alternar: (c: string) => void;
  receitaBase: number;
  resultado: { realizado: number; planejado: number };
}) {
  const desvio = (r: number, p: number): number | null => (p === 0 ? null : ((r - p) / Math.abs(p)) * 100);
  const vert = (v: number): number | null => (receitaBase !== 0 ? (v / receitaBase) * 100 : null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
            <th className="text-left px-4 py-2 font-medium">Conta</th>
            <th className="text-right px-3 py-2 font-medium">Orçado</th>
            <th className="text-right px-3 py-2 font-medium">Realizado</th>
            <th className="text-right px-3 py-2 font-medium">Δ R$</th>
            <th className="text-right px-3 py-2 font-medium">Δ %</th>
            <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">%RL</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const real = valorPeriodo(l.realizado, periodo);
            const plan = valorPeriodo(l.planejado, periodo);
            const d = real - plan;
            const dp = desvio(real, plan);
            const cor = d >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
            return (
              <tr key={l.codigo} className={cn(
                "border-b border-[var(--border)] last:border-0",
                l.nivel === 2 ? "bg-blue-50/50 dark:bg-blue-950/20 font-semibold" : "hover:bg-[var(--bg)]"
              )}>
                <td className="px-4 py-2 text-[var(--text)]" style={{ paddingLeft: `${16 + (l.nivel - 2) * 14}px` }}>
                  <button onClick={() => l.temFilhos && alternar(l.codigo)}
                    className={cn("inline-flex items-center gap-1 text-left", l.temFilhos ? "cursor-pointer" : "cursor-default")}>
                    {l.temFilhos ? (abertos.has(l.codigo) ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="inline-block w-[13px]" />}
                    <span>{l.nome}</span>
                  </button>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-muted)]">{formatNumero(plan)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", real < 0 && "text-red-600 dark:text-red-400")}>{formatNumero(real)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", cor)}>{d >= 0 ? "+" : ""}{formatNumero(d)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", cor)}>{dp !== null ? `${dp >= 0 ? "+" : ""}${formatPct(dp)}` : "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-muted)] hidden sm:table-cell">{vert(real) !== null ? formatPct(vert(real)!) : "–"}</td>
              </tr>
            );
          })}
          {(() => {
            const d = resultado.realizado - resultado.planejado;
            const dp = desvio(resultado.realizado, resultado.planejado);
            const cor = d >= 0 ? "text-emerald-300" : "text-red-300";
            return (
              <tr className="bg-[#0000C2] text-white font-bold">
                <td className="px-4 py-2">RESULTADO</td>
                <td className="px-3 py-2 text-right tabular-nums text-white/80">{formatNumero(resultado.planejado)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumero(resultado.realizado)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", cor)}>{d >= 0 ? "+" : ""}{formatNumero(d)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", cor)}>{dp !== null ? `${dp >= 0 ? "+" : ""}${formatPct(dp)}` : "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums hidden sm:table-cell">{vert(resultado.realizado) !== null ? formatPct(vert(resultado.realizado)!) : "–"}</td>
              </tr>
            );
          })()}
        </tbody>
      </table>
    </div>
  );
}

