"use client";

import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import SeletorPessoa from "@/components/fluxo-caixa/SeletorPessoa";
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
  filiais?: { cd: number; nome: string }[];
  /** Nome dos fornecedores já apontados nos lançamentos. */
  nomesPessoas?: Map<number, string>;
  /** Cria uma linha direto na grade (bloco/unidade aberta → "+ nova linha"). */
  onCriar?: (dados: { bloco_id: string; unidade: number | null; descricao: string; cd_pessoa: number | null; parcelas: { vencimento: string; valor: number }[] }) => Promise<void>;
  /** Troca o fornecedor de um lançamento direto na grade. */
  onFornecedor?: (l: Lancamento, cd: number | null) => void;
}

const somaVis = (m: Map<string, number> | undefined, meses: string[]) =>
  meses.reduce((s, x) => s + (m?.get(x) ?? 0), 0);
const somaMapas = (ms: (Map<string, number> | undefined)[]) => {
  const out = new Map<string, number>();
  for (const m of ms) m?.forEach((v, k) => out.set(k, (out.get(k) ?? 0) + v));
  return out;
};
// nível 0 é o bloco; cada sub-bloco, unidade, lançamento e fornecedor desce um.
const recuo = (nivel: number) => 12 + nivel * 24;
const somar = (mapa: Map<string, number>, mes: string, v: number) => mapa.set(mes, (mapa.get(mes) ?? 0) + v);

export default function VisaoFluxo({
  blocos, lancamentos, premissas, saldos, onAbrir, onCriar, onFornecedor,
  filiais = [], nomesPessoas = new Map(),
}: Props) {
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
  const [novo, setNovo] = useState<{ bloco: string; unidade: number | null; descricao: string; cdPessoa: number | null; valores: Record<string, string> } | null>(null);
  const [fornecedorDe, setFornecedorDe] = useState<string | null>(null);
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

  function abrirNovo(bloco: string, unidade: number | null) {
    setMilhares(false); // digitando em R$ cheio não há dúvida de escala
    setErroNovo("");
    setNovo({ bloco, unidade, descricao: "", cdPessoa: null, valores: {} });
  }

  async function salvarNovo() {
    if (!novo || !onCriar || salvando) return;
    const parcelas = parcelasNovas(novo);
    if (!novo.descricao.trim()) { setErroNovo("Dê um nome para a linha."); return; }
    if (parcelas.length === 0) { setErroNovo("Preencha o valor de pelo menos um mês."); return; }
    setSalvando(true); setErroNovo("");
    try {
      await onCriar({ bloco_id: novo.bloco, unidade: novo.unidade, descricao: novo.descricao.trim(), cd_pessoa: novo.cdPessoa, parcelas });
      setNovo({ bloco: novo.bloco, unidade: novo.unidade, descricao: "", cdPessoa: null, valores: {} }); // pronta para a próxima
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

  function linhaNova(b: Bloco, recuo: number) {
    const n = novo!;
    const campo = "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--text)]";
    const fundo = "bg-[#EEEEFD] dark:bg-[#1b1b3a]";
    return (
      <tr key={`n-${b.id}-${n.unidade ?? "s"}`} className={cn("border-t border-[var(--border)]", fundo)}>
        <td className={cn("sticky left-0 z-10 py-1 pr-3 shadow-[2px_0_4px_rgba(0,0,0,0.05)]", fundo)} style={{ paddingLeft: recuo }}>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input autoFocus value={n.descricao} placeholder="Nome da linha" onKeyDown={teclado}
                onChange={(e) => setNovo({ ...n, descricao: e.target.value })} className={cn(campo, "w-56")} />
              <button onClick={salvarNovo} disabled={salvando} title="Salvar (Enter)"
                className="rounded bg-[var(--primary)] p-1 text-white disabled:opacity-50"><Check size={12} /></button>
              <button onClick={() => setNovo(null)} title="Cancelar (Esc)"
                className="rounded border border-[var(--border)] p-1 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={12} /></button>
            </div>
            <div className="flex items-center gap-1">
              <select value={n.unidade ?? ""} onChange={(e) => setNovo({ ...n, unidade: e.target.value ? Number(e.target.value) : null })}
                title="Unidade" className={cn(campo, "w-28")}>
                <option value="">Sem unidade</option>
                {filiais.map((fi) => <option key={fi.cd} value={fi.cd}>{fi.cd}</option>)}
              </select>
              <div className="w-56">
                <SeletorPessoa valor={n.cdPessoa} placeholder="Fornecedor no ERP (opcional)"
                  onChange={(cd) => setNovo({ ...n, cdPessoa: cd })} className="py-1 text-xs" />
              </div>
            </div>
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

  function linhaTexto(chave: string, conteudo: ReactNode, recuo: number, onClick?: () => void) {
    return (
      <tr key={chave} onClick={onClick} className={cn("border-t border-[var(--border)]", onClick && cn("group cursor-pointer", HOVER))}>
        <td colSpan={meses.length + 2} className={cn("py-1.5 text-xs text-[var(--text-muted)]", onClick && "group-hover:text-[var(--primary)]")}
          style={{ paddingLeft: recuo }}>
          {conteudo}
        </td>
      </tr>
    );
  }

  function linhaFluxo(opts: {
    chave: string; nome: ReactNode; valores?: Map<string, number>; nivel: number; zebra?: boolean;
    subtitulo?: boolean; onClick?: () => void; titulo?: string;
  }) {
    const total = somaVis(opts.valores, meses);
    const bg = opts.zebra ? ZEBRA : "bg-[var(--surface)]";
    return (
      <tr key={opts.chave} onClick={opts.onClick}
        className={cn("group", opts.zebra && ZEBRA, HOVER, opts.onClick && "cursor-pointer",
          opts.nivel === 0 ? "border-t border-slate-300 font-bold dark:border-slate-600" : "border-t border-[var(--border)]",
          opts.subtitulo && "font-semibold")}>
        <td className={cn("sticky left-0 z-10 max-w-[22rem] truncate whitespace-nowrap py-1.5 pr-3 shadow-[2px_0_4px_rgba(0,0,0,0.05)]", bg, HOVER_FIXA,
          opts.nivel !== 0 && !opts.subtitulo && "font-normal text-[var(--text-muted)]")}
          style={{ paddingLeft: recuo(opts.nivel) }} title={opts.titulo}>
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

  const filhosDe = (id: string) => blocos.filter((b) => b.pai_id === id);

  // Fornecedor do lançamento: mostra e deixa escolher na lista do ERP.
  function linhaFornecedor(l: Lancamento, nivel: number) {
    const nome = l.cd_pessoa != null ? (nomesPessoas.get(l.cd_pessoa) ?? `Pessoa ${l.cd_pessoa}`) : null;
    if (!onFornecedor && !nome) return null;
    if (fornecedorDe === l.id && onFornecedor) {
      return (
        <tr key={`f-${l.id}`} className="border-t border-[var(--border)] bg-[#EEEEFD] dark:bg-[#1b1b3a]">
          <td colSpan={meses.length + 2} className="py-1 pr-3" style={{ paddingLeft: recuo(nivel) }}>
            <div className="flex items-center gap-2">
              <div className="w-72">
                <SeletorPessoa valor={l.cd_pessoa ?? null} nomeInicial={nome} className="py-1 text-xs"
                  placeholder="Escolher fornecedor no ERP"
                  onChange={(cd) => { setFornecedorDe(null); onFornecedor(l, cd); }} />
              </div>
              <button onClick={() => setFornecedorDe(null)}
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">fechar</button>
            </div>
          </td>
        </tr>
      );
    }
    return linhaTexto(`f-${l.id}`,
      nome
        ? <span className="inline-flex items-center gap-1"><span className="tabular-nums opacity-60">{l.cd_pessoa}</span>{nome}</span>
        : <span className="inline-flex items-center gap-1 opacity-70"><Plus size={11} /> sem fornecedor</span>,
      recuo(nivel), onFornecedor ? () => setFornecedorDe(l.id) : undefined);
  }

  // O fornecedor fica escondido até abrir a seta do lançamento — sem ele, a
  // grade ficaria com uma linha a mais embaixo de cada item.
  function linhasDoItem(l: Lancamento, nivel: number) {
    const chave = `fo-${l.id}`;
    const aberto = abertos.has(chave);
    const temFornecedor = l.cd_pessoa != null;
    const fora: ReactNode[] = [linhaFluxo({
      chave: `l-${l.id}`, nivel, valores: calc.porLanc.get(l.id), onClick: () => onAbrir(l), titulo: l.descricao,
      nome: (
        <span className="inline-flex items-center gap-1">
          <span role="button" tabIndex={0} title={temFornecedor ? "Ver o fornecedor" : "Ligar a um fornecedor do ERP"}
            onClick={(e) => { e.stopPropagation(); alternar(chave); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); alternar(chave); } }}
            className={cn("-ml-4 shrink-0 rounded p-0.5 hover:text-[var(--primary)]",
              temFornecedor ? "text-[var(--primary)]" : "text-[var(--text-muted)]/50")}>
            {aberto ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
          {l.descricao}
        </span>
      ),
    })];
    if (aberto) {
      const linha = linhaFornecedor(l, nivel + 1);
      if (linha) fora.push(linha);
    }
    return fora;
  }

  function linhaCriar(b: Bloco, unidade: number | null, nivel: number) {
    const fora: ReactNode[] = [];
    if (!onCriar) return fora;
    const px = recuo(nivel);
    const chave = `${b.id}|${unidade ?? ""}`;
    if (novo && `${novo.bloco}|${novo.unidade ?? ""}` === chave) {
      fora.push(linhaNova(b, px));
      if (erroNovo) fora.push(linhaTexto(`e-${chave}`, <span className="text-red-600 dark:text-red-400">{erroNovo}</span>, px));
    } else {
      fora.push(linhaTexto(`+${chave}`, <span className="inline-flex items-center gap-1"><Plus size={12} /> nova linha</span>,
        px, () => abrirNovo(b.id, unidade)));
    }
    return fora;
  }

  const rotuloUnidade = (u: number | null) => {
    if (u == null) return "Sem unidade";
    const nome = filiais.find((f) => f.cd === u)?.nome;
    return nome ? `Unidade ${u} — ${nome}` : `Unidade ${u}`;
  };

  // Linhas de dentro de um bloco: premissa, unidades, itens, fornecedores e a
  // linha de criar. Blocos sem nenhuma unidade pulam esse nível.
  function linhasDoBloco(b: Bloco, nivel: number) {
    const fora: ReactNode[] = [];
    const premissa = PREMISSA_DO_BLOCO[b.id];
    if (premissa) {
      fora.push(linhaFluxo({ chave: `p-${b.id}`, nivel, valores: calc.porPremissa.get(premissa.tipo), nome: <i>{premissa.rotulo}</i> }));
    }
    // Itens do bloco com movimento no período, dos maiores para os menores.
    const itens = lancamentos
      .filter((l) => l.bloco_id === b.id && l.status !== "cancelado")
      .map((l) => ({ l, total: somaVis(calc.porLanc.get(l.id), meses) }))
      .filter((x) => meses.some((m) => (calc.porLanc.get(x.l.id)?.get(m) ?? 0) !== 0))
      .sort((a, b2) => Math.abs(b2.total) - Math.abs(a.total));

    if (itens.some((x) => x.l.unidade != null)) {
      const porUnidade = new Map<number | null, typeof itens>();
      for (const item of itens) porUnidade.set(item.l.unidade ?? null, [...(porUnidade.get(item.l.unidade ?? null) ?? []), item]);
      const grupos = [...porUnidade.entries()]
        .map(([unidade, lista]) => ({
          unidade, lista,
          valores: somaMapas(lista.map((x) => calc.porLanc.get(x.l.id))),
          total: lista.reduce((s, x) => s + x.total, 0),
        }))
        .sort((a, b2) => Math.abs(b2.total) - Math.abs(a.total));
      for (const g of grupos) {
        const chave = `u-${b.id}-${g.unidade ?? "s"}`;
        const abertoU = abertos.has(chave);
        fora.push(linhaFluxo({
          chave, nivel, subtitulo: true, valores: g.valores, onClick: () => alternar(chave),
          nome: <span className="inline-flex items-center gap-1">{abertoU ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{rotuloUnidade(g.unidade)}</span>,
        }));
        if (!abertoU) continue;
        for (const { l } of g.lista) fora.push(...linhasDoItem(l, nivel + 1));
        fora.push(...linhaCriar(b, g.unidade, nivel + 1));
      }
      return fora;
    }

    for (const { l } of itens) fora.push(...linhasDoItem(l, nivel));
    if (!premissa && itens.length === 0 && novo?.bloco !== b.id && filhosDe(b.id).length === 0) {
      fora.push(linhaTexto(`v-${b.id}`, "Nenhum lançamento neste período.", recuo(nivel)));
    }
    fora.push(...linhaCriar(b, null, nivel));
    return fora;
  }

  const alternar = (id: string) =>
    setAbertos((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Um bloco mostra o que é dele e o que está nos sub-blocos, em qualquer profundidade.
  function valoresComFilhos(b: Bloco): Map<string, number> {
    return somaMapas([calc.porBloco.get(b.id), ...filhosDe(b.id).map(valoresComFilhos)]);
  }

  function linhasDaArvore(b: Bloco, nivel: number, zebra?: boolean) {
    const fora: ReactNode[] = [];
    const filhos = filhosDe(b.id);
    const aberto = abertos.has(b.id);
    const seta = nivel === 0 ? 13 : 12;
    fora.push(linhaFluxo({
      chave: `b-${b.id}`, nivel, zebra, subtitulo: nivel > 0,
      valores: filhos.length ? valoresComFilhos(b) : calc.porBloco.get(b.id),
      onClick: () => alternar(b.id),
      nome: <span className="inline-flex items-center gap-1">{aberto ? <ChevronDown size={seta} /> : <ChevronRight size={seta} />}{b.nome}</span>,
    }));
    if (!aberto) return fora;
    fora.push(...linhasDoBloco(b, nivel + 1));
    for (const filho of filhos) fora.push(...linhasDaArvore(filho, nivel + 1));
    return fora;
  }

  const linhas: ReactNode[] = [];
  blocos.filter((b) => !b.pai_id).forEach((b, i) => { linhas.push(...linhasDaArvore(b, 0, i % 2 === 1)); });

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
        Os blocos com unidade preenchida abrem em unidade e lançamento; a setinha na frente do lançamento mostra o fornecedor (azul quando já tem um), e
        clicar nele escolhe outro no cadastro do ERP. Clique no lançamento para editar. Dentro do bloco aberto, <b>+ nova linha</b> cria um lançamento
        aqui mesmo: nome, valor nos meses e Enter para salvar (Esc cancela). O valor entra em R$ cheios, com o sinal do bloco —
        digite <b>+</b> ou <b>−</b> na frente para inverter.
      </p>
    </div>
  );
}
