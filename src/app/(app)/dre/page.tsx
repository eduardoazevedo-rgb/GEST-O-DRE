"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MESES_CURTO, formatNumero, formatPct } from "@/lib/labels";
import { buscarDre, dreEmCache } from "@/lib/dre-fetch";
import SeletorMeses from "@/components/SeletorMeses";
import type { DreLinha, DreResposta } from "@/lib/types";

type Modo = "comparativo" | "realizado" | "planejado" | "desvio";
type Vigencia =
  | "orcado"
  | "anual" | "semestral" | "trimestral" | "mensal"
  | "mensalYoY" | "trimestralYoY" | "semestralYoY";

const MODOS: { valor: Modo; rotulo: string }[] = [
  { valor: "comparativo", rotulo: "Planejado vs Realizado" },
  { valor: "realizado", rotulo: "Realizado" },
  { valor: "planejado", rotulo: "Planejado" },
  { valor: "desvio", rotulo: "Desvio %" },
];

// Grão temporal de cada vigência (null = modo orçado, tratado à parte).
const BASE: Record<Vigencia, "anual" | "semestral" | "trimestral" | "mensal" | null> = {
  orcado: null,
  anual: "anual", semestral: "semestral", trimestral: "trimestral", mensal: "mensal",
  mensalYoY: "mensal", trimestralYoY: "trimestral", semestralYoY: "semestral",
};
const ehYoY = (v: Vigencia) => v.endsWith("YoY");

type Balde = { label: string; meses: number[] };
function baldes(vig: Vigencia): Balde[] {
  switch (BASE[vig]) {
    case "anual": return [{ label: "", meses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }];
    case "semestral": return [
      { label: "S1", meses: [0, 1, 2, 3, 4, 5] },
      { label: "S2", meses: [6, 7, 8, 9, 10, 11] },
    ];
    case "trimestral": return [
      { label: "T1", meses: [0, 1, 2] }, { label: "T2", meses: [3, 4, 5] },
      { label: "T3", meses: [6, 7, 8] }, { label: "T4", meses: [9, 10, 11] },
    ];
    case "mensal": return MESES_CURTO.map((m, i) => ({ label: m, meses: [i] }));
    default: return [];
  }
}

type Coluna = {
  key: string; label: string; borda: boolean;
  tipo: "valor" | "pct";
  ano?: number; meses: number[];        // valor
  anoNum?: number; anoDen?: number;     // pct (YoY)
};
type Grupo = { label: string; span: number };

/** Monta grupos (linha superior do cabeçalho) e colunas a partir da vigência + anos. */
function montarColunas(vig: Vigencia, anos: number[], mesesFiltro: number[]): { grupos: Grupo[] | null; colunas: Coluna[] } {
  let bs = baldes(vig);
  // Filtro de meses: restringe cada balde aos meses marcados; some baldes vazios.
  if (mesesFiltro.length < 12) {
    const sel = new Set(mesesFiltro);
    bs = bs
      .map((b) => ({ ...b, meses: b.meses.filter((m) => sel.has(m)) }))
      .filter((b) => b.meses.length > 0);
  }
  if (!ehYoY(vig)) {
    if (BASE[vig] === "anual") {
      return {
        grupos: null,
        colunas: anos.map((a) => ({ key: `v${a}`, label: String(a), borda: true, tipo: "valor", ano: a, meses: bs[0].meses })),
      };
    }
    const grupos = anos.map((a) => ({ label: String(a), span: bs.length }));
    const colunas = anos.flatMap((a) =>
      bs.map((b, i) => ({ key: `v${a}-${b.label}`, label: b.label, borda: i === 0, tipo: "valor" as const, ano: a, meses: b.meses }))
    );
    return { grupos, colunas };
  }
  // Ano sobre ano: agrupa por período (mês/tri/sem); anos lado a lado + YoY do último par.
  const temYoY = anos.length >= 2;
  const ultimo = anos[anos.length - 1];
  const penultimo = anos[anos.length - 2];
  const grupos = bs.map((b) => ({ label: b.label || "Ano", span: anos.length + (temYoY ? 1 : 0) }));
  const colunas = bs.flatMap((b) => {
    const cols: Coluna[] = anos.map((a, i) => ({
      key: `${b.label}-${a}`, label: String(a), borda: i === 0, tipo: "valor", ano: a, meses: b.meses,
    }));
    if (temYoY) cols.push({ key: `${b.label}-yoy`, label: "YoY", borda: false, tipo: "pct", anoNum: ultimo, anoDen: penultimo, meses: b.meses });
    return cols;
  });
  return { grupos, colunas };
}

function soma(v: number[]): number { return v.reduce((a, b) => a + b, 0); }
function somaMeses(v: number[], meses: number[]): number { return meses.reduce((a, m) => a + (v[m] ?? 0), 0); }
function desvioPct(realizado: number, planejado: number): number | null {
  if (planejado === 0) return null;
  return ((realizado - planejado) / Math.abs(planejado)) * 100;
}

export default function DrePage() {
  const anoAtual = new Date().getFullYear();
  const anosDisponiveis = [anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3];

  const [ano, setAno] = useState(anoAtual);
  const [mesesSel, setMesesSel] = useState<number[]>([]); // vazio = ano todo
  const [vigencia, setVigencia] = useState<Vigencia>("orcado");
  const [modo, setModo] = useState<Modo>("comparativo");
  const [periodoAnos, setPeriodoAnos] = useState<number[]>([anoAtual, anoAtual - 1, anoAtual - 2]);
  const [dadosPorAno, setDadosPorAno] = useState<Map<number, DreResposta>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const comparativoAnual = vigencia !== "orcado";
  const periodoAnosSorted = useMemo(() => [...periodoAnos].sort((a, b) => a - b), [periodoAnos]);

  const anosNecessarios = useMemo(
    () => (comparativoAnual ? periodoAnosSorted : [ano]),
    [comparativoAnual, periodoAnosSorted, ano]
  );

  const carregar = useCallback(async () => {
    if (anosNecessarios.length === 0) { setDadosPorAno(new Map()); setCarregando(false); return; }
    const cached = anosNecessarios.map((a) => [a, dreEmCache(a)] as const);
    if (cached.every(([, d]) => d)) {
      setDadosPorAno(new Map(cached as [number, DreResposta][]));
      setCarregando(false);
    } else setCarregando(true);
    setErro("");
    try {
      const entradas = await Promise.all(
        anosNecessarios.map(async (a) => [a, await buscarDre(a)] as const)
      );
      setDadosPorAno(new Map(entradas));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [anosNecessarios]);

  useEffect(() => { carregar(); }, [carregar]);

  function alternar(codigo: string) {
    setAbertos((prev) => {
      const novo = new Set(prev);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  }

  function toggleAno(a: number) {
    setPeriodoAnos((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  // Árvore de contas exibida: no modo orçado vem do ano; no comparativo, do ano mais recente selecionado.
  const arvore: DreResposta | null = useMemo(() => {
    if (!comparativoAnual) return dadosPorAno.get(ano) ?? null;
    const maior = periodoAnosSorted[periodoAnosSorted.length - 1];
    return maior !== undefined ? (dadosPorAno.get(maior) ?? null) : null;
  }, [comparativoAnual, dadosPorAno, ano, periodoAnosSorted]);

  const visiveis = useMemo(() => {
    if (!arvore) return [] as DreLinha[];
    return arvore.linhas.filter((l) => {
      if (l.nivel <= 2) return true;
      const partes = l.codigo.split(".");
      for (let n = 2; n < partes.length; n++) {
        if (!abertos.has(partes.slice(0, n).join("."))) return false;
      }
      return true;
    });
  }, [arvore, abertos]);

  // Acesso rápido ao realizado por (ano, código) e ao total N2 por ano (RESULTADO).
  const realizadoPorAnoCod = useMemo(() => {
    const m = new Map<number, Map<string, number[]>>();
    for (const [a, d] of dadosPorAno) m.set(a, new Map(d.linhas.map((l) => [l.codigo, l.realizado])));
    return m;
  }, [dadosPorAno]);

  const totalN2PorAno = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const [a, d] of dadosPorAno) {
      const n2 = d.linhas.filter((l) => l.nivel === 2);
      m.set(a, Array.from({ length: 12 }, (_, mo) => n2.reduce((acc, l) => acc + l.realizado[mo], 0)));
    }
    return m;
  }, [dadosPorAno]);

  const zeros = useMemo(() => Array(12).fill(0) as number[], []);
  const realizadoDe = useCallback(
    (a: number, codigo: string) => realizadoPorAnoCod.get(a)?.get(codigo) ?? zeros,
    [realizadoPorAnoCod, zeros]
  );

  // Meses ativos: nenhum marcado = ano todo (12). Total aparece quando há mais de um.
  const mesesAtivos = useMemo(
    () => (mesesSel.length === 0 ? [...Array(12).keys()] : [...mesesSel].sort((a, b) => a - b)),
    [mesesSel]
  );
  const mesesVis = mesesAtivos;
  const mostrarTotal = mesesAtivos.length > 1;
  const labelsMes = mostrarTotal ? [...mesesAtivos.map((m) => MESES_CURTO[m]), "Total"] : [MESES_CURTO[mesesAtivos[0]]];

  const { grupos, colunas } = useMemo(
    () => montarColunas(vigencia, periodoAnosSorted, mesesAtivos),
    [vigencia, periodoAnosSorted, mesesAtivos]
  );

  // Totais do modo orçado (Plan vs Real), por mês.
  const totalGeral = useMemo(() => {
    const zero = { realizado: Array(12).fill(0), planejado: Array(12).fill(0) };
    const d = dadosPorAno.get(ano);
    if (!d) return zero;
    const n2 = d.linhas.filter((l) => l.nivel === 2);
    return {
      realizado: Array.from({ length: 12 }, (_, m) => n2.reduce((a, l) => a + l.realizado[m], 0)),
      planejado: Array.from({ length: 12 }, (_, m) => n2.reduce((a, l) => a + l.planejado[m], 0)),
    };
  }, [dadosPorAno, ano]);

  // ---- Renderização de células ----

  // Modo orçado (mesma lógica de antes): meses marcados × sub-modo.
  function celulasOrcado(realizado: number[], planejado: number[], destaque = false, naFaixa = false) {
    const meses = mesesVis;
    const base = cn("px-2 py-1.5 text-right tabular-nums whitespace-nowrap", destaque && "font-semibold");
    // Na faixa azul do RESULTADO, cores claras (legíveis sobre o azul escuro).
    const cNeg = naFaixa ? "text-red-300" : "text-red-600 dark:text-red-400";
    const cPos = naFaixa ? "text-emerald-300" : "text-emerald-600 dark:text-emerald-400";
    const cMut = naFaixa ? "text-white/70" : "text-[var(--text-muted)]";
    const cBorda = naFaixa ? "border-white/20" : "border-[var(--border)]";
    if (modo === "realizado" || modo === "planejado") {
      const valores = modo === "realizado" ? realizado : planejado;
      return (
        <>
          {meses.map((m) => (
            <td key={m} className={cn(base, valores[m] < 0 && cNeg)}>
              {valores[m] !== 0 ? formatNumero(valores[m]) : "–"}
            </td>
          ))}
          {mostrarTotal && (
            <td className={cn(base, "border-l font-semibold", cBorda, soma(valores) < 0 && cNeg)}>
              {formatNumero(soma(valores))}
            </td>
          )}
        </>
      );
    }
    if (modo === "desvio") {
      return (
        <>
          {meses.map((m) => {
            const d = desvioPct(realizado[m], planejado[m]);
            return (
              <td key={m} className={cn(base, d !== null && d < 0 && cNeg, d !== null && d >= 0 && cPos)}>
                {d !== null ? formatPct(d) : "–"}
              </td>
            );
          })}
          {mostrarTotal && (() => {
            const d = desvioPct(soma(realizado), soma(planejado));
            return (
              <td className={cn(base, "border-l font-semibold", cBorda, d !== null && d < 0 && cNeg, d !== null && d >= 0 && cPos)}>
                {d !== null ? formatPct(d) : "–"}
              </td>
            );
          })()}
        </>
      );
    }
    const bloco = (r: number, p: number, chave: string | number, comBorda: boolean) => {
      const d = desvioPct(r, p);
      return (
        <>
          <td key={`p${chave}`} className={cn(base, comBorda && "border-l", comBorda && cBorda, cMut)}>
            {p !== 0 ? formatNumero(p) : "–"}
          </td>
          <td key={`r${chave}`} className={cn(base, r < 0 && cNeg)}>
            {r !== 0 ? formatNumero(r) : "–"}
          </td>
          <td key={`d${chave}`} className={cn(base, "pr-3", d !== null && d < 0 && cNeg, d !== null && d >= 0 && cPos)}>
            {d !== null ? formatPct(d) : "–"}
          </td>
        </>
      );
    };
    return (
      <>
        {meses.map((m) => bloco(realizado[m], planejado[m], m, true))}
        {mostrarTotal && bloco(soma(realizado), soma(planejado), "total", true)}
      </>
    );
  }

  // Modo comparativo (Vigência/Período): uma célula por coluna, realizado por ano/balde.
  function celulasComparativo(getArr: (a: number) => number[], destaque = false, naFaixa = false) {
    const base = cn("px-2 py-1.5 text-right tabular-nums whitespace-nowrap", destaque && "font-semibold");
    const cNeg = naFaixa ? "text-red-300" : "text-red-600 dark:text-red-400";
    const cPos = naFaixa ? "text-emerald-300" : "text-emerald-600 dark:text-emerald-400";
    const cBorda = naFaixa ? "border-white/20" : "border-[var(--border)]";
    return colunas.map((c) => {
      const borda = c.borda ? cn("border-l", cBorda) : "";
      if (c.tipo === "valor") {
        const v = somaMeses(getArr(c.ano!), c.meses);
        return (
          <td key={c.key} className={cn(base, borda, v < 0 && cNeg)}>
            {v !== 0 ? formatNumero(v) : "–"}
          </td>
        );
      }
      const d = desvioPct(somaMeses(getArr(c.anoNum!), c.meses), somaMeses(getArr(c.anoDen!), c.meses));
      return (
        <td key={c.key} className={cn(base, borda, "pr-3", d !== null && d < 0 && cNeg, d !== null && d >= 0 && cPos)}>
          {d !== null ? formatPct(d) : "–"}
        </td>
      );
    });
  }

  const semPeriodo = comparativoAnual && periodoAnosSorted.length === 0;
  const faltaParYoY = comparativoAnual && ehYoY(vigencia) && periodoAnosSorted.length < 2;
  const versaoNome = dadosPorAno.get(ano)?.versaoNome;
  const versaoId = dadosPorAno.get(ano)?.versaoId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-[var(--text)]">DRE — Planejado vs Realizado</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Vigência */}
          <select
            value={vigencia}
            onChange={(e) => setVigencia(e.target.value as Vigencia)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
          >
            <optgroup label="Orçado">
              <option value="orcado">Orçado (Plan vs Real)</option>
            </optgroup>
            <optgroup label="Sequencial">
              <option value="anual">Anual</option>
              <option value="semestral">Semestral</option>
              <option value="trimestral">Trimestral</option>
              <option value="mensal">Mensal</option>
            </optgroup>
            <optgroup label="Ano sobre ano">
              <option value="mensalYoY">Mensal (YoY)</option>
              <option value="trimestralYoY">Trimestral (YoY)</option>
              <option value="semestralYoY">Semestral (YoY)</option>
            </optgroup>
          </select>

          {/* Filtro de meses (multi) — vale para todas as vigências */}
          <SeletorMeses sel={mesesSel} onChange={setMesesSel} />

          {/* Modo orçado: seletor de ano + sub-modos */}
          {!comparativoAnual && (
            <>
              <select
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
              >
                {Array.from({ length: 6 }, (_, i) => anoAtual + 1 - i).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
                {MODOS.map((m) => (
                  <button
                    key={m.valor}
                    onClick={() => setModo(m.valor)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      modo === m.valor ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    )}
                  >
                    {m.rotulo}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Comparativo anual: seleção de período (anos) */}
          {comparativoAnual && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--text-muted)]">Período:</span>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
                {anosDisponiveis.map((a) => (
                  <button
                    key={a}
                    onClick={() => toggleAno(a)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      periodoAnos.includes(a) ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={carregar}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-muted)] hover:text-[var(--text)]"
            title="Recarregar"
          >
            <RefreshCw size={16} className={cn(carregando && "animate-spin")} />
          </button>
        </div>
      </div>

      {!comparativoAnual && versaoNome && (
        <p className="text-xs text-[var(--text-muted)]">Orçamento: {versaoNome}</p>
      )}
      {!comparativoAnual && dadosPorAno.get(ano) && !versaoId && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Nenhuma versão de orçamento ativa para {ano} — colunas de planejado ficarão zeradas.
        </p>
      )}
      {comparativoAnual && (
        <p className="text-xs text-[var(--text-muted)]">
          Realizado · {ehYoY(vigencia) ? "comparação ano sobre ano" : "períodos lado a lado"}
          {periodoAnosSorted.length > 0 ? ` · ${periodoAnosSorted.join(", ")}` : ""}
        </p>
      )}
      {erro && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>
      )}
      {semPeriodo && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Selecione ao menos um ano no Período.
        </div>
      )}
      {faltaParYoY && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          A comparação YoY precisa de ao menos dois anos selecionados no Período.
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-xs">
          <thead>
            {!comparativoAnual ? (
              <>
                <tr className="bg-[#0000C2] text-white">
                  <th rowSpan={modo === "comparativo" ? 2 : 1} className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-56">
                    Conta
                  </th>
                  {labelsMes.map((m) => (
                    <th key={m} colSpan={modo === "comparativo" ? 3 : 1} className="border-l border-white/20 px-2 py-1.5 text-center font-semibold">
                      {m}
                    </th>
                  ))}
                </tr>
                {modo === "comparativo" && (
                  <tr className="bg-[#0000C2] text-white/80">
                    {labelsMes.map((_, i) => <MiniCabecalho key={i} />)}
                  </tr>
                )}
              </>
            ) : (
              <>
                {grupos ? (
                  <>
                    <tr className="bg-[#0000C2] text-white">
                      <th rowSpan={2} className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-56">Conta</th>
                      {grupos.map((g, i) => (
                        <th key={i} colSpan={g.span} className="border-l border-white/20 px-2 py-1.5 text-center font-semibold">{g.label}</th>
                      ))}
                    </tr>
                    <tr className="bg-[#0000C2] text-white/80">
                      {colunas.map((c) => (
                        <th key={c.key} className={cn("px-2 py-1 text-right font-normal", c.borda && "border-l border-white/20")}>{c.label}</th>
                      ))}
                    </tr>
                  </>
                ) : (
                  <tr className="bg-[#0000C2] text-white">
                    <th className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-56">Conta</th>
                    {colunas.map((c) => (
                      <th key={c.key} className="border-l border-white/20 px-2 py-1.5 text-right font-semibold">{c.label}</th>
                    ))}
                  </tr>
                )}
              </>
            )}
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={40} className="px-3 py-8 text-center text-[var(--text-muted)]">Carregando…</td></tr>
            )}
            {!carregando && visiveis.map((l) => (
              <tr
                key={l.codigo}
                className={cn(
                  "border-t border-[var(--border)]",
                  l.nivel === 2 ? "font-semibold" : "hover:bg-[var(--bg)]"
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 z-10 whitespace-nowrap px-3 py-1.5 bg-[var(--surface)]",
                    l.nivel === 2 && "font-semibold"
                  )}
                  style={{ paddingLeft: `${(l.nivel - 1) * 14}px` }}
                >
                  <button
                    onClick={() => l.temFilhos && alternar(l.codigo)}
                    className={cn("inline-flex items-center gap-1 text-left", l.temFilhos ? "cursor-pointer" : "cursor-default")}
                  >
                    {l.temFilhos ? (
                      abertos.has(l.codigo) ? <ChevronDown size={13} /> : <ChevronRight size={13} />
                    ) : (
                      <span className="inline-block w-[13px]" />
                    )}
                    <span className="text-[var(--text)]">{l.codigo}. {l.nome}</span>
                  </button>
                </td>
                {comparativoAnual
                  ? celulasComparativo((a) => realizadoDe(a, l.codigo), l.nivel === 2)
                  : celulasOrcado(l.realizado, l.planejado, l.nivel === 2)}
              </tr>
            ))}
            {!carregando && arvore && (
              <tr className="border-t-2 border-[#0000C2] bg-[#0000C2] text-white font-bold">
                <td className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2">RESULTADO</td>
                {comparativoAnual
                  ? celulasComparativo((a) => totalN2PorAno.get(a) ?? zeros, true, true)
                  : celulasOrcado(totalGeral.realizado, totalGeral.planejado, true, true)}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!comparativoAnual && arvore && arvore.naoMapeado.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {arvore.naoMapeado.length} conta(s) do ERP sem de-para — valores fora do DRE acima
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            Configure o mapeamento na tela Plano de Contas.
          </p>
        </div>
      )}
    </div>
  );
}

function MiniCabecalho() {
  return (
    <>
      <th className="border-l border-white/20 px-2 py-1 text-right font-normal">Plan.</th>
      <th className="px-2 py-1 text-right font-normal">Real.</th>
      <th className="px-2 py-1 pr-3 text-right font-normal">Desv.</th>
    </>
  );
}
