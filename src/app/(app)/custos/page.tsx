"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MESES_CURTO, formatNumero } from "@/lib/labels";
import type { DreLinha, DreResposta } from "@/lib/types";
import { buscarDre, dreEmCache } from "@/lib/dre-fetch";
import SeletorMeses from "@/components/SeletorMeses";
import type { CustoFornecedorResposta } from "@/app/api/custos/fornecedor/route";

function soma(v: number[]): number { return v.reduce((a, b) => a + b, 0); }
function somaArrays(arrs: number[][]): number[] {
  const r = Array(12).fill(0);
  for (const a of arrs) for (let m = 0; m < 12; m++) r[m] += a[m] ?? 0;
  return r;
}
function paiCod(codigo: string): string | null {
  const i = codigo.lastIndexOf(".");
  return i > 0 ? codigo.slice(0, i) : null;
}
// Sufixo de classificação (SERV)/(VEN)/(ADM) no fim do nome da conta.
const RE_SUFIXO = /\s*\((?:VEN|ADM|SERV)\)\s*$/i;
function stripSufixo(nome: string): string {
  return nome.replace(RE_SUFIXO, "").trim();
}
function temSufixo(nome: string): boolean {
  return RE_SUFIXO.test(nome);
}

// Nó da árvore exibida. codigosFonte = código(s) gerencial(is) reais para o
// drill de fornecedor (num nó unificado há mais de um: VEN + ADM). A RPC agrega
// por prefixo, então num nó com filhos basta o próprio código.
type No = { key: string; nome: string; codigo?: string; nivel: number; realizado: number[]; filhos: No[]; codigosFonte: string[] };

// A partir do N4 a conta já é analisável por fornecedor mesmo tendo filhos.
const NIVEL_DETALHE = 4;

// mostrarCodigo: no modo unificado as contas não têm um código único, então a
// tela fica só com os nomes — inclusive nas que não foram agrupadas.
function filhosNormais(linhas: DreLinha[], codigoPai: string, mostrarCodigo: boolean): No[] {
  return linhas
    .filter((l) => paiCod(l.codigo) === codigoPai)
    .map((l) => noNormal(l, linhas, mostrarCodigo));
}

function noNormal(l: DreLinha, linhas: DreLinha[], mostrarCodigo: boolean): No {
  return {
    key: l.codigo, nome: l.nome, codigo: mostrarCodigo ? l.codigo : undefined,
    nivel: l.nivel, realizado: l.realizado,
    filhos: l.temFilhos ? filhosNormais(linhas, l.codigo, mostrarCodigo) : [],
    codigosFonte: [l.codigo],
  };
}

// Junta as contas N4 de mesma natureza pelo nome, ignorando o sufixo: PESSOAL
// (SERV) + PESSOAL (VEN) + PESSOAL (ADM) viram uma linha só. O mesmo vale para
// os N5 abaixo delas (SALARIOS (SERV) + SALARIOS (VEN) + ...).
function unificarSufixadas(n4: DreLinha[], linhas: DreLinha[]): No[] {
  const grupos = new Map<string, DreLinha[]>();
  for (const l of n4) {
    const b = stripSufixo(l.nome);
    (grupos.get(b) ?? grupos.set(b, []).get(b)!).push(l);
  }
  const nos: No[] = [];
  for (const [base, membros] of grupos) {
    const codsMembros = new Set(membros.map((m) => m.codigo));
    const n5 = linhas.filter((l) => l.nivel === 5 && codsMembros.has(paiCod(l.codigo) ?? ""));
    const gN5 = new Map<string, DreLinha[]>();
    for (const l of n5) {
      const b = stripSufixo(l.nome);
      (gN5.get(b) ?? gN5.set(b, []).get(b)!).push(l);
    }
    const filhos: No[] = [...gN5.entries()]
      .map(([bN5, ms]) => ({
        key: `u|${base}|${bN5}`, nome: bN5, nivel: 5, realizado: somaArrays(ms.map((m) => m.realizado)),
        filhos: [], codigosFonte: ms.map((m) => m.codigo),
      }))
      .sort((a, b) => soma(a.realizado) - soma(b.realizado));
    nos.push({
      key: `u|${base}`, nome: base, nivel: 4, realizado: somaArrays(membros.map((m) => m.realizado)),
      filhos, codigosFonte: membros.map((m) => m.codigo),
    });
  }
  return nos;
}

// O relatório começa no N4: sem as linhas de grupo N2/N3, uma conta por linha,
// da maior despesa para a menor.
function construirArvore(dre: DreResposta | null, unificar: boolean): No[] {
  if (!dre) return [];
  // classe 3, fora Receita (3.1)
  const linhas = dre.linhas.filter((l) => l.codigo.startsWith("3") && l.codigo.split(".").slice(0, 2).join(".") !== "3.1");
  const n4 = linhas.filter((l) => l.nivel === 4);
  const nos = unificar
    ? [
        ...unificarSufixadas(n4.filter((l) => temSufixo(l.nome)), linhas),
        ...n4.filter((l) => !temSufixo(l.nome)).map((l) => noNormal(l, linhas, false)),
      ]
    : n4.map((l) => noNormal(l, linhas, true));
  return nos.sort((a, b) => soma(a.realizado) - soma(b.realizado));
}

// Junta o detalhe (unidade × fornecedor) de vários códigos numa resposta só.
function mergeDetalhes(rs: CustoFornecedorResposta[]): CustoFornecedorResposta {
  const uni = new Map<number, { nome: string; valor: number[]; forn: Map<string, { cd_pessoa: number | null; nome: string; valor: number[] }> }>();
  for (const r of rs) for (const u of r.unidades) {
    let x = uni.get(u.cd_empresa_erp);
    if (!x) { x = { nome: u.nome, valor: Array(12).fill(0), forn: new Map() }; uni.set(u.cd_empresa_erp, x); }
    for (let m = 0; m < 12; m++) x.valor[m] += u.valor[m] ?? 0;
    for (const f of u.fornecedores) {
      const k = f.cd_pessoa === null ? "null" : String(f.cd_pessoa);
      let ff = x.forn.get(k);
      if (!ff) { ff = { cd_pessoa: f.cd_pessoa, nome: f.nome, valor: Array(12).fill(0) }; x.forn.set(k, ff); }
      for (let m = 0; m < 12; m++) ff.valor[m] += f.valor[m] ?? 0;
    }
  }
  return {
    codigo: "",
    unidades: [...uni.entries()]
      .map(([cd, x]) => ({
        cd_empresa_erp: cd, nome: x.nome, valor: x.valor,
        fornecedores: [...x.forn.values()].sort((a, b) => soma(a.valor) - soma(b.valor)),
      }))
      .sort((a, b) => soma(a.valor) - soma(b.valor)),
  };
}

export default function CustosPage() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [mesesSel, setMesesSel] = useState<number[]>([]); // vazio = ano todo
  const [unificar, setUnificar] = useState(true);

  // Meses exibidos: nenhum marcado = ano todo (12). Total quando há mais de um.
  const mesesVis = mesesSel.length === 0 ? [...Array(12).keys()] : [...mesesSel].sort((a, b) => a - b);
  const mostrarTotal = mesesVis.length > 1;
  const nCols = 1 + mesesVis.length + (mostrarTotal ? 1 : 0);
  const somaVis = (arr: number[]) => mesesVis.reduce((a, m) => a + (arr[m] ?? 0), 0);
  const [dre, setDre] = useState<DreResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [abertosDet, setAbertosDet] = useState<Set<string>>(new Set());
  const [abertosUnidade, setAbertosUnidade] = useState<Set<string>>(new Set());
  const [detalhe, setDetalhe] = useState<Map<string, CustoFornecedorResposta>>(new Map());
  const [carregandoDet, setCarregandoDet] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    const cache = dreEmCache(ano);
    if (cache) { setDre(cache); setCarregando(false); } else setCarregando(true);
    setErro("");
    setDetalhe(new Map());
    setAbertosDet(new Set());
    setAbertosUnidade(new Set());
    try {
      setDre(await buscarDre(ano));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [ano]);

  useEffect(() => { carregar(); }, [carregar]);

  const arvore = useMemo(() => construirArvore(dre, unificar), [dre, unificar]);

  const buscarDetalhe = useCallback(async (key: string, codigos: string[]) => {
    setCarregandoDet((s) => new Set(s).add(key));
    try {
      const respostas = await Promise.all(
        codigos.map(async (cod) => {
          const res = await fetch(`/api/custos/fornecedor?ano=${ano}&codigo=${encodeURIComponent(cod)}`);
          return res.ok ? ((await res.json()) as CustoFornecedorResposta) : { codigo: cod, unidades: [] };
        })
      );
      setDetalhe((m) => new Map(m).set(key, mergeDetalhes(respostas)));
    } finally {
      setCarregandoDet((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [ano]);

  // Seta: abre os filhos; na folha, abre direto o detalhe por fornecedor.
  function alternarNo(no: No) {
    if (no.filhos.length === 0) { alternarDetalhe(no); return; }
    setAbertos((prev) => { const n = new Set(prev); if (n.has(no.key)) n.delete(no.key); else n.add(no.key); return n; });
  }
  // Ícone de fornecedor: detalhe consolidado da conta (a RPC agrega por prefixo).
  function alternarDetalhe(no: No) {
    const aberto = abertosDet.has(no.key);
    setAbertosDet((prev) => { const n = new Set(prev); if (aberto) n.delete(no.key); else n.add(no.key); return n; });
    if (!aberto && !detalhe.has(no.key)) buscarDetalhe(no.key, no.codigosFonte);
  }
  function alternarUnidade(chave: string) {
    setAbertosUnidade((prev) => { const n = new Set(prev); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  }
  function alternarUnificar() {
    setUnificar((u) => !u);
    setAbertos(new Set());
    setAbertosDet(new Set());
    setAbertosUnidade(new Set());
    setDetalhe(new Map());
  }

  function linhaMes(opts: {
    chave: string; depth: number; nome: string; codigoTag?: string; arr: number[];
    tipo: "conta" | "unidade" | "fornecedor";
    expandivel?: boolean; aberto?: boolean; carregando?: boolean; onToggle?: () => void; zebra?: boolean;
    onDetalhe?: () => void; detAberto?: boolean; carregandoDet?: boolean;
  }): ReactNode {
    const total = somaVis(opts.arr);
    const cel = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
    const mudo = opts.tipo === "fornecedor";
    const contaRaiz = opts.tipo === "conta" && opts.depth === 0;
    // Negrito dinâmico: as contas N4 (raiz do relatório) sempre; demais só quando expandidas.
    const negrito = contaRaiz || !!opts.aberto;
    const peso = negrito ? "font-bold" : opts.tipo === "unidade" ? "font-medium" : "font-normal";
    // Separador mais marcado entre as contas N4; linha fina no detalhe.
    const sep = contaRaiz ? "border-t-2 border-slate-300 dark:border-slate-600" : "border-t border-[var(--border)]";
    // Zebra neutra só no fornecedor (cor sólida p/ a célula fixa cobrir o scroll).
    const zebra = opts.tipo === "fornecedor" && opts.zebra;
    const bgCel = zebra ? "bg-gray-50 dark:bg-neutral-800" : "bg-[var(--surface)]";
    const corValor = (v: number) =>
      v > 0 ? "text-emerald-600 dark:text-emerald-400" : mudo ? "text-[var(--text-muted)]" : "text-[var(--text)]";
    return (
      <tr key={opts.chave} className={cn(sep, peso, zebra && "bg-gray-50 dark:bg-neutral-800", "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]")}>
        <td className={cn("sticky left-0 z-10 whitespace-nowrap pr-3", bgCel)}
          style={{ paddingLeft: `${12 + opts.depth * 16}px` }}>
          <div className="flex items-center gap-1">
            <button onClick={opts.onToggle}
              className={cn("flex items-center gap-1 py-1.5 text-left", opts.expandivel ? "cursor-pointer" : "cursor-default")}>
              {opts.carregando ? <Loader2 size={13} className="animate-spin shrink-0" />
                : opts.expandivel ? (opts.aberto ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />)
                : <span className="inline-block w-[13px] shrink-0" />}
              <span className={cn(mudo && "text-[var(--text-muted)]")}>
                {opts.codigoTag && <span className="text-[var(--text-muted)] mr-1">{opts.codigoTag}</span>}
                {opts.nome}
              </span>
            </button>
            {opts.onDetalhe && (
              <button onClick={opts.onDetalhe}
                title={opts.detAberto ? "Ocultar unidades e fornecedores" : "Ver unidades e fornecedores desta conta"}
                className={cn(
                  "shrink-0 rounded p-1 transition-colors",
                  opts.detAberto
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--text-muted)] hover:bg-black/[0.06] hover:text-[var(--text)] dark:hover:bg-white/10"
                )}>
                {opts.carregandoDet ? <Loader2 size={12} className="animate-spin" /> : <Users size={12} />}
              </button>
            )}
          </div>
        </td>
        {mesesVis.map((m) => {
          const v = opts.arr[m] ?? 0;
          return (
            <td key={m} className={cn(cel, v !== 0 && corValor(v))}>
              {v !== 0 ? formatNumero(v) : <span className="text-[var(--text-muted)]/40">–</span>}
            </td>
          );
        })}
        {mostrarTotal && (
          <td className={cn(cel, "border-l border-[var(--border)] font-bold", total > 0 && "text-emerald-600 dark:text-emerald-400")}>
            {formatNumero(total)}
          </td>
        )}
      </tr>
    );
  }

  function renderNo(no: No, depth: number, out: ReactNode[]) {
    const folha = no.filhos.length === 0;
    // Folha abre o fornecedor pela própria seta; do N4 pra baixo, pelo ícone.
    const detalhavel = no.codigosFonte.length > 0 && (folha || no.nivel >= NIVEL_DETALHE);
    const detAberto = abertosDet.has(no.key);
    const filhosAbertos = !folha && abertos.has(no.key);
    const carregandoEste = carregandoDet.has(no.key);

    out.push(linhaMes({
      chave: `n-${no.key}`, depth, nome: no.nome,
      codigoTag: no.codigo ? `${no.codigo}.` : undefined,
      arr: no.realizado, tipo: "conta",
      expandivel: !folha || detalhavel,
      aberto: folha ? detAberto : filhosAbertos,
      carregando: folha && carregandoEste,
      onToggle: () => alternarNo(no),
      onDetalhe: !folha && detalhavel ? () => alternarDetalhe(no) : undefined,
      detAberto, carregandoDet: carregandoEste,
    }));

    if (detalhavel && detAberto) renderDetalhe(no, depth, out);
    if (filhosAbertos) for (const f of no.filhos) renderNo(f, depth + 1, out);
  }

  // Detalhe da conta: unidade → fornecedor, um nível abaixo da linha da conta.
  function renderDetalhe(no: No, depth: number, out: ReactNode[]) {
    const padMsg = `${12 + (depth + 1) * 14 + 20}px`;
    const det = detalhe.get(no.key);
    if (carregandoDet.has(no.key) && !det) {
      out.push(
        <tr key={`load-${no.key}`} className="border-t border-[var(--border)]">
          <td colSpan={nCols} className="py-2 text-xs text-[var(--text-muted)]" style={{ paddingLeft: padMsg }}>
            <Loader2 size={12} className="inline animate-spin mr-1" /> carregando fornecedores…
          </td>
        </tr>
      );
    } else if (det && det.unidades.length === 0) {
      out.push(
        <tr key={`vazio-${no.key}`} className="border-t border-[var(--border)]">
          <td colSpan={nCols} className="py-2 text-xs text-[var(--text-muted)]" style={{ paddingLeft: padMsg }}>
            Sem lançamentos por fornecedor nesta conta.
          </td>
        </tr>
      );
    } else if (det) {
      for (const u of det.unidades) {
        const chaveU = `${no.key}|${u.cd_empresa_erp}`;
        const uAberto = abertosUnidade.has(chaveU);
        out.push(linhaMes({
          chave: `u-${chaveU}`, depth: depth + 1, nome: u.nome, codigoTag: String(u.cd_empresa_erp),
          arr: u.valor, tipo: "unidade", expandivel: true, aberto: uAberto, onToggle: () => alternarUnidade(chaveU),
        }));
        if (uAberto) {
          let fi = 0;
          for (const f of u.fornecedores) {
            if (somaVis(f.valor) === 0) continue;
            out.push(linhaMes({
              chave: `f-${chaveU}-${f.cd_pessoa ?? "null"}`, depth: depth + 2, nome: f.nome, arr: f.valor,
              tipo: "fornecedor", zebra: fi % 2 === 1,
            }));
            fi++;
          }
        }
      }
    }
  }

  function renderLinhas(): ReactNode[] {
    const out: ReactNode[] = [];
    for (const no of arvore) renderNo(no, 0, out);
    return out;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Análise de custos</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Contas N4 de custo e despesa, da maior para a menor · o ícone <Users size={11} className="inline align-[-1px]" /> abre
            unidade → fornecedor consolidado da conta; a seta detalha até a folha
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={alternarUnificar}
            title="Junta as contas (SERV), (VEN) e (ADM) de mesmo nome numa linha só"
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              unificar
                ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            Unificar SERV/VEN/ADM {unificar ? "•" : ""}
          </button>
          <SeletorMeses sel={mesesSel} onChange={setMesesSel} />
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

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-[#0000C2] text-white">
              <th className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-64">
                Conta / Unidade / Fornecedor
              </th>
              {mesesVis.map((m) => (
                <th key={m} className="border-l border-white/20 px-2 py-1.5 text-right font-semibold">{MESES_CURTO[m]}</th>
              ))}
              {mostrarTotal && <th className="border-l border-white/20 px-2 py-1.5 text-right font-semibold">Total</th>}
            </tr>
          </thead>
          <tbody>
            {carregando
              ? <tr><td colSpan={nCols} className="px-3 py-8 text-center text-[var(--text-muted)]">Carregando…</td></tr>
              : renderLinhas()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
