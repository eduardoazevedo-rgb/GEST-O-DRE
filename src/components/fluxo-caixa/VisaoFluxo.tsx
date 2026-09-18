"use client";

import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PREMISSA_DO_BLOCO, calcularSaldos, formatGrade, lerValor, listarMeses, mesDe, rotuloMes, somarMeses,
  type Bloco, type Lancamento, type Premissa, type SaldoReal,
} from "@/lib/fluxo-caixa";

// Mesma identidade da Análise de custos: cores sólidas na coluna fixa.
const AZUL = "#0000C2";
const ZEBRA = "bg-[#F1F2F6] dark:bg-neutral-800";
const HOVER = "hover:bg-[#EDEDFA] dark:hover:bg-[#191934]";
const HOVER_FIXA = "group-hover:bg-[#EDEDFA] dark:group-hover:bg-[#191934]";
const COL_TOTAL = "border-l-2 border-slate-300 bg-black/[0.03] dark:border-slate-600 dark:bg-white/[0.04]";

interface Props {
  blocos: Bloco[];
  lancamentos: Lancamento[];
  premissas: Premissa[];
  saldos: SaldoReal[];
  onAbrir: (l: Lancamento) => void;
  /** Cria uma linha direto na grade (bloco aberto → "+ nova linha"). */
  onCriar?: (dados: { bloco_id: string; descricao: string; parcelas: { vencimento: string; valor: number }[] }) => Promise<void>;
}

const somaVis = (m: Map<string, number> | undefined, meses: string[]) =>
  meses.reduce((s, x) => s + (m?.get(x) ?? 0), 0);
const somar = (mapa: Map<string, number>, mes: string, v: number) => mapa.set(mes, (mapa.get(mes) ?? 0) + v);

export default function VisaoFluxo({ blocos, lancamentos, premissas, saldos, onAbrir, onCriar }: Props) {
  // Todos os meses com algum dado, para montar os seletores e o padrão.
  const mesesComDado = useMemo(() => {
    const s = new Set<string>();
    for (const l of lancamentos) for (const p of l.parcelas) s.add(mesDe(p.vencimento));
    for (const p of premissas) s.add(p.mes);
    for (const r of saldos) s.add(r.mes);
    return [...s].sort();
  }, [lancamentos, premissas, saldos]);

  const inicioAno = `${new Date().getFullYear()}-01-01`;
  const primeiro = mesesComDado[0] ?? inicioAno;
  const ultimo = mesesComDado[mesesComDado.length - 1] ?? somarMeses(inicioAno, 11);
  const opcoes = listarMeses(primeiro < inicioAno ? primeiro : inicioAno, somarMeses(ultimo > inicioAno ? ultimo : inicioAno, 12));

  const [de, setDe] = useState(inicioAno);
  const [ate, setAte] = useState(() => {
    const padrao = ultimo > somarMeses(inicioAno, 11) ? ultimo : somarMeses(inicioAno, 11);
    return padrao > somarMeses(inicioAno, 23) ? somarMeses(inicioAno, 23) : padrao;
  });
  const [milhares, setMilhares] = useState(true);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [novo, setNovo] = useState<{ bloco: string; descricao: string; valores: Record<string, string> } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroNovo, setErroNovo] = useState("");

  const meses = useMemo(() => (de <= ate ? listarMeses(de, ate) : []), [de, ate]);

  const calc = useMemo(() => {
    const total = new Map<string, number>();
    const porBloco = new Map<string, Map<string, number>>();
    const porLanc = new Map<string, Map<string, number>>();
    const porPremissa = new Map<Premissa["tipo"], Map<string, number>>();
    const doBloco = (id: string) => porBloco.get(id) ?? porBloco.set(id, new Map()).get(id)!;

    for (const l of lancamentos) {
      if (l.status === "cancelado") continue;
      const ml = new Map<string, number>();
      for (const p of l.parcelas) {
        const m = mesDe(p.vencimento);
        somar(ml, m, p.valor); somar(doBloco(l.bloco_id), m, p.valor); somar(total, m, p.valor);
      }
      porLanc.set(l.id, ml);
    }
    for (const p of premissas) {
      const bloco = p.tipo === "clientes" ? "recebimentos" : "fornecedores";
      const mp = porPremissa.get(p.tipo) ?? porPremissa.set(p.tipo, new Map()).get(p.tipo)!;
      somar(mp, p.mes, p.valor); somar(doBloco(bloco), p.mes, p.valor); somar(total, p.mes, p.valor);
    }
    const reais = new Map(saldos.map((s) => [s.mes, s.valor]));
    return { porBloco, porLanc, porPremissa, reais, saldo: calcularSaldos(meses, total, reais) };
  }, [lancamentos, premissas, saldos, meses]);

  const cel = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
  const vazio = <span className="text-[var(--text-muted)]/40">–</span>;
  const numero = (v: number | null | undefined, cor = true) =>
    v == null || v === 0 ? vazio : (
      <span className={cn(cor && v > 0 && "text-emerald-600 dark:text-emerald-400")}>{formatGrade(v, milhares)}</span>
    );

  // ---------- linha nova, digitada na própria grade ----------
  const sinalDoBloco = (b: string) => (b === "recebimentos" ? 1 : -1);

  function parcelasNovas(n: { bloco: string; valores: Record<string, string> }) {
    const out: { vencimento: string; valor: number }[] = [];
    for (const m of meses) {
      const txt = (n.valores[m] ?? "").trim();
      const v = lerValor(txt);
      if (!v) continue;
      // Sem sinal na frente vale o sentido do bloco: recebimento entra, o resto sai.
      const explicito = txt.startsWith("-") || txt.startsWith("+");
      out.push({ vencimento: m, valor: explicito ? v : Math.abs(v) * sinalDoBloco(n.bloco) });
    }
    return out;
  }

  function abrirNovo(bloco: string) {
    setMilhares(false); // digitando em R$ cheio não há dúvida de escala
    setErroNovo("");
    setNovo({ bloco, descricao: "", valores: {} });
  }

  async function salvarNovo() {
    if (!novo || !onCriar || salvando) return;
    const parcelas = parcelasNovas(novo);
    if (!novo.descricao.trim()) { setErroNovo("Dê um nome para a linha."); return; }
    if (parcelas.length === 0) { setErroNovo("Preencha o valor de pelo menos um mês."); return; }
    setSalvando(true); setErroNovo("");
    try {
      await onCriar({ bloco_id: novo.bloco, descricao: novo.descricao.trim(), parcelas });
      setNovo({ bloco: novo.bloco, descricao: "", valores: {} }); // pronta para a próxima
    } catch (e) {
      setErroNovo(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  function teclado(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); salvarNovo(); }
    if (e.key === "Escape") { e.preventDefault(); setNovo(null); }
  }

  function linhaNova(b: Bloco) {
    const n = novo!;
    const campo = "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--text)]";
    const fundo = "bg-[#EEEEFD] dark:bg-[#1b1b3a]";
    return (
      <tr key={`n-${b.id}`} className={cn("border-t border-[var(--border)]", fundo)}>
        <td className={cn("sticky left-0 z-10 py-1 pr-3 shadow-[2px_0_4px_rgba(0,0,0,0.05)]", fundo)} style={{ paddingLeft: 36 }}>
          <div className="flex items-center gap-1">
            <input autoFocus value={n.descricao} placeholder="Nome da linha" onKeyDown={teclado}
              onChange={(e) => setNovo({ ...n, descricao: e.target.value })} className={cn(campo, "w-56")} />
            <button onClick={salvarNovo} disabled={salvando} title="Salvar (Enter)"
              className="rounded bg-[var(--primary)] p-1 text-white disabled:opacity-50"><Check size={12} /></button>
            <button onClick={() => setNovo(null)} title="Cancelar (Esc)"
              className="rounded border border-[var(--border)] p-1 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={12} /></button>
          </div>
        </td>
        {meses.map((m) => (
          <td key={m} className="px-1 py-1">
            <input value={n.valores[m] ?? ""} inputMode="decimal" placeholder="0" onKeyDown={teclado}
              onChange={(e) => setNovo({ ...n, valores: { ...n.valores, [m]: e.target.value } })}
              className={cn(campo, "text-right tabular-nums")} />
          </td>
        ))}
        <td className={cn(cel, COL_TOTAL, "font-bold")}>{numero(parcelasNovas(n).reduce((s, p) => s + p.valor, 0))}</td>
      </tr>
    );
  }

  function linhaFluxo(opts: {
    chave: string; nome: ReactNode; valores?: Map<string, number>; nivel: 0 | 1; zebra?: boolean;
    aberto?: boolean; onClick?: () => void; titulo?: string;
  }) {
    const total = somaVis(opts.valores, meses);
    const bg = opts.zebra ? ZEBRA : "bg-[var(--surface)]";
    return (
      <tr key={opts.chave} onClick={opts.onClick}
        className={cn("group", opts.zebra && ZEBRA, HOVER, opts.onClick && "cursor-pointer",
          opts.nivel === 0 ? "border-t border-slate-300 font-bold dark:border-slate-600" : "border-t border-[var(--border)]")}>
        <td className={cn("sticky left-0 z-10 max-w-[22rem] truncate whitespace-nowrap py-1.5 pr-3 shadow-[2px_0_4px_rgba(0,0,0,0.05)]", bg, HOVER_FIXA,
          opts.nivel === 1 && "font-normal text-[var(--text-muted)]")}
          style={{ paddingLeft: opts.nivel === 0 ? 12 : 36 }} title={opts.titulo}>
          {opts.nome}
        </td>
        {meses.map((m) => <td key={m} className={cel}>{numero(opts.valores?.get(m))}</td>)}
        <td className={cn(cel, COL_TOTAL, "font-bold")}>{numero(total)}</td>
      </tr>
    );
  }

  function linhaSaldo(chave: string, nome: string, valor: (m: string) => ReactNode, extra?: string) {
    return (
      <tr key={chave} className={cn("group border-t-2 border-slate-300 font-extrabold dark:border-slate-600", HOVER, extra)}>
        <td className={cn("sticky left-0 z-10 whitespace-nowrap bg-[var(--surface)] py-2 pl-3 pr-3 uppercase tracking-wide shadow-[2px_0_4px_rgba(0,0,0,0.05)]", HOVER_FIXA)}>
          {nome}
        </td>
        {meses.map((m) => <td key={m} className={cn(cel, "py-2")}>{valor(m)}</td>)}
        <td className={cn(cel, COL_TOTAL)} />
      </tr>
    );
  }

  const linhas: ReactNode[] = [];
  blocos.forEach((b, i) => {
    const aberto = abertos.has(b.id);
    const valores = calc.porBloco.get(b.id);
    const alternar = () => setAbertos((prev) => { const n = new Set(prev); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; });
    linhas.push(linhaFluxo({
      chave: `b-${b.id}`, nivel: 0, zebra: i % 2 === 1, valores, aberto, onClick: alternar,
      nome: <span className="inline-flex items-center gap-1">{aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{b.nome}</span>,
    }));
    if (!aberto) return;

    const premissa = PREMISSA_DO_BLOCO[b.id];
    if (premissa) {
      linhas.push(linhaFluxo({ chave: `p-${b.id}`, nivel: 1, valores: calc.porPremissa.get(premissa.tipo), nome: <i>{premissa.rotulo}</i> }));
    }
    // Itens do bloco com movimento no período, dos maiores para os menores.
    const itens = lancamentos
      .filter((l) => l.bloco_id === b.id && l.status !== "cancelado")
      .map((l) => ({ l, total: somaVis(calc.porLanc.get(l.id), meses) }))
      .filter((x) => meses.some((m) => (calc.porLanc.get(x.l.id)?.get(m) ?? 0) !== 0))
      .sort((a, b2) => Math.abs(b2.total) - Math.abs(a.total));
    for (const { l } of itens) {
      linhas.push(linhaFluxo({
        chave: `l-${l.id}`, nivel: 1, valores: calc.porLanc.get(l.id), onClick: () => onAbrir(l), titulo: l.descricao,
        nome: <>{l.unidade && <span className="mr-1 text-[var(--text-muted)]/70">{l.unidade}</span>}{l.descricao}</>,
      }));
    }
    if (!premissa && itens.length === 0 && novo?.bloco !== b.id) {
      linhas.push(
        <tr key={`v-${b.id}`} className="border-t border-[var(--border)]">
          <td colSpan={meses.length + 2} className="py-2 pl-9 text-xs text-[var(--text-muted)]">Nenhum lançamento neste período.</td>
        </tr>
      );
    }
    if (!onCriar) return;
    if (novo?.bloco === b.id) {
      linhas.push(linhaNova(b));
      if (erroNovo) linhas.push(
        <tr key={`e-${b.id}`} className="border-t border-[var(--border)]">
          <td colSpan={meses.length + 2} className="py-1 pl-9 text-xs text-red-600 dark:text-red-400">{erroNovo}</td>
        </tr>
      );
    } else {
      linhas.push(
        <tr key={`+${b.id}`} onClick={() => abrirNovo(b.id)} className={cn("group cursor-pointer border-t border-[var(--border)]", HOVER)}>
          <td colSpan={meses.length + 2} className="py-1.5 text-xs text-[var(--text-muted)] group-hover:text-[var(--primary)]" style={{ paddingLeft: 36 }}>
            <span className="inline-flex items-center gap-1"><Plus size={12} /> nova linha</span>
          </td>
        </tr>
      );
    }
  });

  const s = calc.saldo;
  const fechado = (m: string) => calc.reais.has(m);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="fc-de">De</label>
        <select id="fc-de" value={de} onChange={(e) => setDe(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]">
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <label className="text-xs text-[var(--text-muted)]" htmlFor="fc-ate">até</label>
        <select id="fc-ate" value={ate} onChange={(e) => setAte(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]">
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <button
          onClick={() => setAbertos((prev) => (prev.size === blocos.length ? new Set() : new Set(blocos.map((b) => b.id))))}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {abertos.size === blocos.length ? "Recolher blocos" : "Abrir todos os blocos"}
        </button>
        <button
          onClick={() => setMilhares((v) => !v)}
          className={cn("ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            milhares ? "border-[var(--primary)] bg-[var(--primary)] text-white"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]")}
        >
          R$ mil {milhares ? "•" : ""}
        </button>
      </div>

      {meses.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">O mês inicial precisa ser anterior ao final.</p>
      ) : (
        <div className="max-h-[calc(100vh-17rem)] min-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-white">
                <th style={{ backgroundColor: AZUL }} className="sticky left-0 top-0 z-30 min-w-72 px-3 py-2 text-left font-semibold">
                  Bloco / item {milhares && <span className="font-normal opacity-75">· R$ mil</span>}
                </th>
                {meses.map((m) => (
                  <th key={m} style={{ backgroundColor: AZUL }} className="sticky top-0 z-20 border-l border-white/20 px-2 py-1.5 text-right font-semibold">
                    {rotuloMes(m)}
                    <span className="block text-[10px] font-normal opacity-75">{fechado(m) ? "fechado" : "previsto"}</span>
                  </th>
                ))}
                <th style={{ backgroundColor: AZUL }} className="sticky top-0 z-20 border-l-2 border-white/40 px-2 py-1.5 text-right font-semibold">
                  Total
                  <span className="block text-[10px] font-normal opacity-75">do período</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {linhaSaldo("si", "Saldo inicial", (m) => {
                const x = s.get(m);
                return x ? (
                  <span className={cn(x.inicial < 0 && "text-red-600 dark:text-red-400")}>
                    {formatGrade(x.inicial, milhares)}
                    {x.inicialReal && <span className="ml-1 rounded bg-[#EEEEFD] px-1 text-[9px] font-bold uppercase text-[#0000C2] dark:bg-[#262f6b] dark:text-[#c7c9ff]">real</span>}
                  </span>
                ) : vazio;
              })}
              {linhas.map((l, i) => <Fragment key={i}>{l}</Fragment>)}
              {linhaSaldo("sp", "Saldo previsto final", (m) => {
                const x = s.get(m);
                return x ? <span className={cn(x.previsto < 0 && "text-red-600 dark:text-red-400")}>{formatGrade(x.previsto, milhares)}</span> : vazio;
              })}
              {linhaSaldo("sr", "Saldo real final", (m) => {
                const x = s.get(m);
                return x?.real != null ? formatGrade(x.real, milhares) : vazio;
              })}
              {linhaSaldo("sd", "Diferença previsto × real", (m) => {
                const x = s.get(m);
                if (x?.diferenca == null) return vazio;
                return (
                  <span className={cn("italic", x.diferenca > 0 ? "text-emerald-600 dark:text-emerald-400" : x.diferenca < 0 ? "text-red-600 dark:text-red-400" : "")}>
                    {x.diferenca > 0 ? "+" : ""}{formatGrade(x.diferenca, milhares)}
                  </span>
                );
              }, "font-semibold")}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        Saldo inicial de cada mês: o real do mês anterior quando informado; senão, o previsto do anterior — a mesma regra da planilha.
        Clique num bloco para abrir os itens e num item para editar. Dentro do bloco aberto, <b>+ nova linha</b> cria um lançamento
        aqui mesmo: nome, valor nos meses e Enter para salvar (Esc cancela). O valor entra em R$ cheios, com o sinal do bloco —
        digite <b>+</b> ou <b>−</b> na frente para inverter.
      </p>
    </div>
  );
}
