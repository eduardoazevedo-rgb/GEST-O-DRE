"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MESES_CURTO, formatNumero, formatPct } from "@/lib/labels";
import type { DreLinha, DreResposta } from "@/lib/types";
import { buscarDre, dreEmCache } from "@/lib/dre-fetch";
import { useEmpresa } from "@/context/EmpresaContext";
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
type No = {
  key: string; nome: string; nomeCompleto?: string; codigo?: string; nivel: number;
  realizado: number[]; planejado: number[]; filhos: No[]; codigosFonte: string[];
};

// O que a grade mostra. Desvio = realizado − planejado (positivo = gastou menos
// que o previsto, seguindo a convenção de sinais do ERP).
type Modo = "comparativo" | "realizado" | "planejado" | "desvio";
const MODOS: { valor: Modo; rotulo: string }[] = [
  { valor: "comparativo", rotulo: "Planejado vs Realizado" },
  { valor: "realizado", rotulo: "Realizado" },
  { valor: "planejado", rotulo: "Planejado" },
  { valor: "desvio", rotulo: "Desvio" },
];

// Grade em R$ mil: tira 3 dígitos de cada número sem mentir sobre os pequenos
// (o que arredondaria para zero sai como "~0").
function formatValor(v: number, milhares: boolean): string {
  if (!milhares) return formatNumero(v);
  const m = v / 1000;
  if (v !== 0 && Math.abs(m) < 0.5) return "~0";
  return formatNumero(m);
}

function desvioPct(realizado: number, planejado: number): number | null {
  if (planejado === 0) return null;
  return ((realizado - planejado) / Math.abs(planejado)) * 100;
}

// Paleta da grade. Zebra e realce usam cores SÓLIDAS de propósito: a primeira
// coluna é fixa e precisa cobrir os números que passam por baixo ao rolar — com
// cor translúcida eles apareceriam através dela.
const ZEBRA = "bg-[#F1F2F6] dark:bg-neutral-800";
const HOVER = "hover:bg-[#EDEDFA] dark:hover:bg-[#191934]";
const HOVER_FIXA = "group-hover:bg-[#EDEDFA] dark:group-hover:bg-[#191934]";
// Banda do mês: separador vertical no começo de cada bloco Plan./Real./Desv.
const BORDA_MES = "border-l-2 border-slate-200 dark:border-slate-700";
// Coluna Total: fecha a leitura da linha, então ganha borda e fundo próprios.
const COL_TOTAL = "border-l-2 border-slate-300 bg-black/[0.03] dark:border-slate-600 dark:bg-white/[0.04]";
// Azul da identidade + um tom vizinho, para alternar as faixas de mês no topo.
const AZUL = "#0000C2";
const AZUL_ALT = "#1A1AD1";

// Trio Plan./Real./Desv. de um mês (ou do total) no modo comparativo.
function blocoComparativo(p: number, r: number, chave: string, cel: string, mudo: boolean, milhares: boolean): ReactNode {
  const d = desvioPct(r, p);
  const vazio = <span className="text-[var(--text-muted)]/40">–</span>;
  return (
    <Fragment key={chave}>
      <td className={cn(cel, BORDA_MES, "text-[var(--text-muted)]")}>
        {p !== 0 ? formatValor(p, milhares) : vazio}
      </td>
      <td className={cn(cel, r > 0 && "text-emerald-600 dark:text-emerald-400", mudo && "text-[var(--text-muted)]")}>
        {r !== 0 ? formatValor(r, milhares) : vazio}
      </td>
      <td className={cn(cel, "pr-3",
        d !== null && d >= 0 && "text-emerald-600 dark:text-emerald-400",
        d !== null && d < 0 && "text-red-600 dark:text-red-400")}>
        {d !== null ? formatPct(d) : vazio}
      </td>
    </Fragment>
  );
}

// Cabeçalho de baixo do modo comparativo: as três colunas de cada mês.
// alt = mês de faixa alternada (tom de azul vizinho).
function MiniCabecalho({ alt }: { alt?: boolean }) {
  const fundo = { backgroundColor: alt ? AZUL_ALT : AZUL };
  return (
    <>
      <th style={fundo} className="border-l-2 border-white/25 px-2 py-1 text-right font-normal">Plan.</th>
      <th style={fundo} className="px-2 py-1 text-right font-normal">Real.</th>
      <th style={fundo} className="px-2 py-1 pr-3 text-right font-normal">Desv.</th>
    </>
  );
}
function valoresDoModo(no: No, modo: Modo): number[] {
  if (modo === "planejado") return no.planejado;
  if (modo === "desvio") return no.realizado.map((v, m) => v - (no.planejado[m] ?? 0));
  return no.realizado; // realizado e comparativo (neste, o plan. vai à parte)
}

// O ERP repete o nome do pai em cada filho ("CUSTO DE MERCADORIAS VENDIDAS -
// PNEUS TB"). Ao abrir a conta isso vira uma coluna de texto repetido, então o
// filho fica só com o que ele acrescenta ("PNEUS TB"). O nome inteiro continua
// no title da linha.
function semPrefixoDoPai(nome: string, pai: string): string {
  const n = nome.trim(), pa = pai.trim();
  if (!pa || n.length <= pa.length) return n;
  if (!normalizar(n).startsWith(normalizar(pa))) return n;
  const resto = n.slice(pa.length).replace(/^[s-–—:·]+/, "").trim();
  return resto || n;
}

// mostrarCodigo: no modo unificado as contas não têm um código único, então a
// tela fica só com os nomes — inclusive nas que não foram agrupadas.
function filhosNormais(linhas: DreLinha[], codigoPai: string, mostrarCodigo: boolean, nomePai: string): No[] {
  return linhas
    .filter((l) => paiCod(l.codigo) === codigoPai)
    .map((l) => noNormal(l, linhas, mostrarCodigo, nomePai));
}

function noNormal(l: DreLinha, linhas: DreLinha[], mostrarCodigo: boolean, nomePai?: string): No {
  return {
    key: l.codigo, nome: nomePai ? semPrefixoDoPai(l.nome, nomePai) : l.nome,
    nomeCompleto: l.nome, codigo: mostrarCodigo ? l.codigo : undefined,
    nivel: l.nivel, realizado: l.realizado, planejado: l.planejado,
    filhos: l.temFilhos ? filhosNormais(linhas, l.codigo, mostrarCodigo, l.nome) : [],
    codigosFonte: [l.codigo],
  };
}

// Junta as contas N4 de mesma natureza pelo nome, ignorando o sufixo: PESSOAL
// (SERV) + PESSOAL (VEN) + PESSOAL (ADM) viram uma linha só. O mesmo vale para
// os N5 abaixo delas (SALARIOS (SERV) + SALARIOS (VEN) + ...).
function unificarSufixadas(n4: DreLinha[], linhas: DreLinha[], campoOrdem: "realizado" | "planejado"): No[] {
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
        key: `u|${base}|${bN5}`, nome: semPrefixoDoPai(bN5, base), nomeCompleto: bN5, nivel: 5,
        realizado: somaArrays(ms.map((m) => m.realizado)),
        planejado: somaArrays(ms.map((m) => m.planejado)),
        filhos: [], codigosFonte: ms.map((m) => m.codigo),
      }))
      .sort((a, b) => soma(a[campoOrdem]) - soma(b[campoOrdem]));
    nos.push({
      key: `u|${base}`, nome: base, nivel: 4,
      realizado: somaArrays(membros.map((m) => m.realizado)),
      planejado: somaArrays(membros.map((m) => m.planejado)),
      filhos, codigosFonte: membros.map((m) => m.codigo),
    });
  }
  return nos;
}

// O relatório começa no N4: sem as linhas de grupo N2/N3, uma conta por linha,
// da maior despesa para a menor.
function construirArvore(dre: DreResposta | null, unificar: boolean, modo: Modo): No[] {
  if (!dre) return [];
  // classe 3, fora Receita (3.1)
  const linhas = dre.linhas.filter((l) => l.codigo.startsWith("3") && l.codigo.split(".").slice(0, 2).join(".") !== "3.1");
  const n4 = linhas.filter((l) => l.nivel === 4);
  // No modo Planejado a ordem segue o orçado; nos demais, o realizado.
  const campoOrdem = modo === "planejado" ? "planejado" : "realizado";
  const nos = unificar
    ? [
        ...unificarSufixadas(n4.filter((l) => temSufixo(l.nome)), linhas, campoOrdem),
        ...n4.filter((l) => !temSufixo(l.nome)).map((l) => noNormal(l, linhas, false)),
      ]
    : n4.map((l) => noNormal(l, linhas, true));
  return nos.sort((a, b) => soma(a[campoOrdem]) - soma(b[campoOrdem]));
}

// Busca sem acento e sem caixa: "manutencao" acha "MANUTENÇÃO".
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Filtro do campo de busca: mantém a conta que casa (com o conteúdo dela) e os
// ancestrais de quem casa mais fundo — esses vêm abertos (forcados) para o
// resultado aparecer sem precisar clicar, mas dá para fechar na mão.
//
// Entre aspas o termo vira busca EXATA: "manutencao" traz só a conta chamada
// MANUTENCAO, enquanto manutencao (sem aspas) traz tudo que contém a palavra.
function filtrarArvore(nos: No[], termo: string): { nos: No[]; forcados: Set<string> } {
  const bruto = termo.trim();
  const exato = bruto.length >= 2 && /^["“”'].*["“”']$/.test(bruto);
  const t = normalizar(exato ? bruto.slice(1, -1) : bruto).trim();
  const forcados = new Set<string>();
  if (!t) return { nos, forcados };
  // No exato o código também vale (para achar "3.3.3.05" direto) e o sufixo
  // (SERV)/(VEN)/(ADM) é ignorado, senão "manutencao" não acharia nada com a
  // unificação desligada, onde a conta se chama MANUTENCAO (SERV).
  const casa = (no: No) =>
    exato
      ? normalizar(no.nome).trim() === t
        || normalizar(stripSufixo(no.nome)).trim() === t
        || (no.codigo ?? "") === t
      : normalizar(`${no.codigo ?? ""} ${no.nome}`).includes(t);
  const filtra = (lista: No[]): No[] => {
    const out: No[] = [];
    for (const no of lista) {
      if (casa(no)) { out.push(no); continue; }
      const filhos = filtra(no.filhos);
      if (filhos.length > 0) { forcados.add(no.key); out.push({ ...no, filhos }); }
    }
    return out;
  };
  return { nos: filtra(nos), forcados };
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
  const { empresaId } = useEmpresa();
  const [ano, setAno] = useState(anoAtual);
  const [mesesSel, setMesesSel] = useState<number[]>([]); // vazio = ano todo
  const [unificar, setUnificar] = useState(true);
  const [unidade, setUnidade] = useState<number | null>(null); // null = todas
  const [unidades, setUnidades] = useState<{ cd: number; nome: string }[]>([]);
  const [busca, setBusca] = useState("");
  const [modoSel, setModoSel] = useState<Modo>("comparativo");
  const [milhares, setMilhares] = useState(true);
  // O orçamento não tem quebra por unidade: com uma filial escolhida só o
  // realizado faz sentido, então a grade volta pra ele.
  const semOrcamento = unidade !== null;
  const modo: Modo = semOrcamento ? "realizado" : modoSel;
  // No comparativo cada mês ocupa 3 colunas (Plan./Real./Desv.).
  const comparativo = modo === "comparativo";
  const porMesCols = comparativo ? 3 : 1;

  // Meses exibidos: nenhum marcado = ano todo (12). Total quando há mais de um.
  const mesesVis = mesesSel.length === 0 ? [...Array(12).keys()] : [...mesesSel].sort((a, b) => a - b);
  const mostrarTotal = mesesVis.length > 1;
  const nCols = 1 + mesesVis.length * porMesCols + (mostrarTotal ? porMesCols : 0);
  const somaVis = (arr: number[]) => mesesVis.reduce((a, m) => a + (arr[m] ?? 0), 0);
  const [dre, setDre] = useState<DreResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  // Contas fechadas na mão. Durante a busca os pais de quem casou abrem sozinhos
  // (forcados); sem registrar o fechamento explícito, o clique não teria efeito.
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [abertosDet, setAbertosDet] = useState<Set<string>>(new Set());
  const [abertosUnidade, setAbertosUnidade] = useState<Set<string>>(new Set());
  const [detalhe, setDetalhe] = useState<Map<string, CustoFornecedorResposta>>(new Map());
  const [carregandoDet, setCarregandoDet] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    const cache = dreEmCache(ano, unidade, empresaId);
    if (cache) { setDre(cache); setCarregando(false); } else setCarregando(true);
    setErro("");
    setDetalhe(new Map());
    setAbertosDet(new Set());
    setAbertosUnidade(new Set());
    try {
      setDre(await buscarDre(ano, unidade, empresaId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [ano, unidade, empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Unidades que o usuário enxerga, para o seletor.
  useEffect(() => {
    let vivo = true;
    fetch(`/api/executivo/unidades?ano=${ano}&empresa=${empresaId}`)
      .then((r) => (r.ok ? r.json() : { unidades: [] }))
      .then((j: { unidades?: { cd_empresa_erp: number; nome: string }[] }) => {
        if (!vivo) return;
        setUnidades((j.unidades ?? []).map((u) => ({ cd: u.cd_empresa_erp, nome: u.nome })));
      })
      .catch(() => { /* seletor fica só com "Todas" */ });
    return () => { vivo = false; };
  }, [ano, empresaId]);

  const arvoreCompleta = useMemo(() => construirArvore(dre, unificar, modo), [dre, unificar, modo]);
  const { nos: arvore, forcados } = useMemo(() => filtrarArvore(arvoreCompleta, busca), [arvoreCompleta, busca]);
  // Escala da barra de proporção: a maior conta N4 visível vale 100%.
  const maiorTotal = useMemo(
    () => Math.max(0, ...arvore.map((no) => Math.abs(somaVis(valoresDoModo(no, modo))))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arvore, modo, mesesSel]
  );

  const buscarDetalhe = useCallback(async (key: string, codigos: string[]) => {
    setCarregandoDet((s) => new Set(s).add(key));
    try {
      const respostas = await Promise.all(
        codigos.map(async (cod) => {
          const res = await fetch(`/api/custos/fornecedor?ano=${ano}&empresa=${empresaId}&codigo=${encodeURIComponent(cod)}`);
          return res.ok ? ((await res.json()) as CustoFornecedorResposta) : { codigo: cod, unidades: [] };
        })
      );
      setDetalhe((m) => new Map(m).set(key, mergeDetalhes(respostas)));
    } finally {
      setCarregandoDet((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [ano, empresaId]);

  // Aberto = escolha do usuário; na ausência dela, o que a busca forçou.
  function estaAberto(key: string): boolean {
    return !fechados.has(key) && (abertos.has(key) || forcados.has(key));
  }
  // Seta: abre os filhos; na folha, abre direto o detalhe por fornecedor.
  function alternarNo(no: No) {
    if (no.filhos.length === 0) { alternarDetalhe(no); return; }
    const aberto = estaAberto(no.key);
    setAbertos((prev) => { const n = new Set(prev); if (aberto) n.delete(no.key); else n.add(no.key); return n; });
    setFechados((prev) => { const n = new Set(prev); if (aberto) n.add(no.key); else n.delete(no.key); return n; });
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
    setFechados(new Set());
    setAbertosDet(new Set());
    setAbertosUnidade(new Set());
    setDetalhe(new Map());
  }

  function linhaMes(opts: {
    chave: string; depth: number; nome: string; codigoTag?: string; arr: number[];
    tipo: "conta" | "unidade" | "fornecedor";
    expandivel?: boolean; aberto?: boolean; carregando?: boolean; onToggle?: () => void; zebra?: boolean;
    // Desvio pinta os dois lados: verde = gastou menos que o previsto.
    corDesvio?: boolean;
    // Só no comparativo: o planejado que acompanha o realizado de `arr`.
    arrPlan?: number[];
    // 0..1 — tamanho da barra de proporção na coluna Total (só contas N4).
    barra?: number;
    // Nome inteiro da conta, quando o exibido foi encurtado.
    titulo?: string;
  }): ReactNode {
    const total = somaVis(opts.arr);
    const cel = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
    const mudo = opts.tipo === "fornecedor";
    const contaRaiz = opts.tipo === "conta" && opts.depth === 0;
    // Negrito dinâmico: as contas N4 (raiz do relatório) sempre; demais só quando expandidas.
    const negrito = contaRaiz || !!opts.aberto;
    const peso = negrito ? "font-bold" : opts.tipo === "unidade" ? "font-medium" : "font-normal";
    // Com a zebra separando as contas, a borda grossa virava ruído: fica fina.
    const sep = contaRaiz ? "border-t border-slate-300 dark:border-slate-600" : "border-t border-[var(--border)]";
    // Zebra nas contas N4 (alternada pela ordem na lista) e nos fornecedores.
    const zebra = !!opts.zebra;
    const bgCel = zebra ? ZEBRA : "bg-[var(--surface)]";
    const corValor = (v: number) =>
      v > 0 ? "text-emerald-600 dark:text-emerald-400"
        : opts.corDesvio ? "text-red-600 dark:text-red-400"
        : mudo ? "text-[var(--text-muted)]" : "text-[var(--text)]";
    return (
      <tr key={opts.chave} className={cn("group", sep, peso, zebra && ZEBRA, HOVER)}>
        {/* A sombra à direita descola a coluna fixa do resto quando se rola. */}
        <td className={cn("sticky left-0 z-10 whitespace-nowrap pr-3 shadow-[2px_0_4px_rgba(0,0,0,0.05)]", bgCel, HOVER_FIXA)}
          style={{ paddingLeft: `${12 + opts.depth * 16}px` }}>
          <button onClick={opts.onToggle}
            className={cn("flex items-center gap-1 py-1.5 text-left", opts.expandivel ? "cursor-pointer" : "cursor-default")}>
            {opts.carregando ? <Loader2 size={13} className="animate-spin shrink-0" />
              : opts.expandivel ? (opts.aberto ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />)
              : <span className="inline-block w-[13px] shrink-0" />}
            <span className={cn(mudo && "text-[var(--text-muted)]")} title={opts.titulo ?? opts.nome}>
              {opts.codigoTag && <span className="text-[var(--text-muted)] mr-1">{opts.codigoTag}</span>}
              {opts.nome}
            </span>
          </button>
        </td>
        {comparativo ? (
          <>
            {mesesVis.map((m) => blocoComparativo(opts.arrPlan?.[m] ?? 0, opts.arr[m] ?? 0, `m${m}`, cel, mudo, milhares))}
            {mostrarTotal && blocoComparativo(somaVis(opts.arrPlan ?? []), total, "tot", cn(cel, COL_TOTAL, "font-bold"), mudo, milhares)}
          </>
        ) : (
          <>
            {mesesVis.map((m) => {
              const v = opts.arr[m] ?? 0;
              return (
                <td key={m} className={cn(cel, v !== 0 && corValor(v))}>
                  {v !== 0 ? formatValor(v, milhares) : <span className="text-[var(--text-muted)]/40">–</span>}
                </td>
              );
            })}
            {mostrarTotal && (
              <td className={cn(cel, COL_TOTAL, "relative font-bold", total !== 0 && corValor(total))}>
                {/* Barra de proporção: só nas contas N4, para dar a escala de um olhar. */}
                {opts.barra != null && opts.barra > 0 && (
                  <div aria-hidden className="absolute inset-y-1 right-1 rounded-sm bg-[#0000C2]/[0.10] dark:bg-white/[0.10]"
                    style={{ width: `${Math.max(2, Math.round(opts.barra * 100))}%` }} />
                )}
                <span className="relative">{formatValor(total, milhares)}</span>
              </td>
            )}
          </>
        )}
      </tr>
    );
  }

  function renderNo(no: No, depth: number, out: ReactNode[], zebra = false) {
    const folha = no.filhos.length === 0;
    // O detalhe por unidade → fornecedor sai na folha, pela própria seta.
    const detalhavel = folha && no.codigosFonte.length > 0;
    const detAberto = abertosDet.has(no.key);
    const filhosAbertos = !folha && estaAberto(no.key);
    const carregandoEste = carregandoDet.has(no.key);

    out.push(linhaMes({
      chave: `n-${no.key}`, depth, nome: no.nome,
      codigoTag: no.codigo ? `${no.codigo}.` : undefined,
      arr: valoresDoModo(no, modo), arrPlan: no.planejado,
      tipo: "conta", corDesvio: modo === "desvio", zebra: depth === 0 && zebra,
      titulo: no.nomeCompleto,
      barra: depth === 0 && maiorTotal > 0
        ? Math.abs(somaVis(valoresDoModo(no, modo))) / maiorTotal
        : undefined,
      expandivel: !folha || detalhavel,
      aberto: folha ? detAberto : filhosAbertos,
      carregando: folha && carregandoEste,
      onToggle: () => alternarNo(no),
    }));

    if (folha) { if (detAberto) renderDetalhe(no, depth, out); return; }
    if (filhosAbertos) for (const f of no.filhos) renderNo(f, depth + 1, out);
  }

  // Detalhe da conta: unidade → fornecedor, um nível abaixo da linha da conta.
  function renderDetalhe(no: No, depth: number, out: ReactNode[]) {
    const padMsg = `${12 + (depth + 1) * 14 + 20}px`;
    const bruto = detalhe.get(no.key);
    // Com uma unidade selecionada, o detalhe mostra só ela.
    const det = bruto && unidade !== null
      ? { ...bruto, unidades: bruto.unidades.filter((u) => u.cd_empresa_erp === unidade) }
      : bruto;
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
          // Fornecedor só existe no realizado — nos outros modos o rótulo avisa.
          chave: `u-${chaveU}`, depth: depth + 1, codigoTag: String(u.cd_empresa_erp),
          nome: modo === "realizado" ? u.nome : `${u.nome} (realizado)`,
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
    arvore.forEach((no, i) => renderNo(no, 0, out, i % 2 === 1));
    return out;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Análise de custos</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Contas N4 de custo e despesa, da maior para a menor · abra a conta até a folha
            e destrinche por unidade → fornecedor
            {milhares && <span className="font-medium"> · valores em R$ mil</span>}
            {modo !== "realizado" && (
              <> · orçamento: {dre?.versaoNome ?? "nenhuma versão ativa no ano"}</>
            )}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {MODOS.map((m) => (
              <button key={m.valor} onClick={() => setModoSel(m.valor)}
                disabled={semOrcamento && m.valor !== "realizado"}
                title={semOrcamento && m.valor !== "realizado"
                  ? "O orçamento não tem quebra por unidade — disponível só com “Todas as unidades”"
                  : m.valor === "desvio" ? "Realizado − planejado (verde = gastou menos que o previsto)" : undefined}
                className={cn("rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                  modo === m.valor ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]",
                  semOrcamento && m.valor !== "realizado" && "cursor-not-allowed opacity-40 hover:text-[var(--text-muted)]")}>
                {m.rotulo}
              </button>
            ))}
          </div>
          <button
            onClick={() => setMilhares((v) => !v)}
            title={milhares ? "Mostrar os valores cheios" : "Mostrar os valores em R$ mil"}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              milhares
                ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            R$ mil {milhares ? "•" : ""}
          </button>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={'Buscar conta · "nome" = exato'}
              title={'manutenção traz tudo que contém a palavra; "manutenção" traz só a conta com esse nome exato'}
              className="w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-7 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
            {busca && (
              <button onClick={() => setBusca("")} title="Limpar busca"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]">
                <X size={13} />
              </button>
            )}
          </div>
          <select
            value={unidade ?? ""}
            onChange={(e) => setUnidade(e.target.value === "" ? null : Number(e.target.value))}
            title="Filtrar por unidade"
            className={cn(
              "max-w-56 rounded-lg border px-3 py-1.5 text-sm",
              unidade === null
                ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                : "border-[var(--primary)] bg-[var(--surface)] font-medium text-[var(--text)]"
            )}
          >
            <option value="">Todas as unidades</option>
            {unidades.map((u) => <option key={u.cd} value={u.cd}>{u.cd} · {u.nome}</option>)}
          </select>
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

      {/* max-h + overflow: a rolagem acontece DENTRO da tabela, que é o que
          deixa o cabeçalho e a coluna de contas fixos enquanto se navega. */}
      <div className="max-h-[calc(100vh-15rem)] min-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-[#0000C2] text-white">
              <th rowSpan={comparativo ? 2 : 1} className="sticky left-0 top-0 z-30 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-64">
                Conta / Unidade / Fornecedor
              </th>
              {mesesVis.map((m, i) => (
                <th key={m} colSpan={porMesCols}
                  style={{ backgroundColor: comparativo && i % 2 === 1 ? AZUL_ALT : AZUL }}
                  className={cn("sticky top-0 z-20 border-l-2 border-white/25 px-2 py-1.5 font-semibold", comparativo ? "text-center" : "text-right")}>
                  {MESES_CURTO[m]}
                </th>
              ))}
              {mostrarTotal && (
                <th colSpan={porMesCols} style={{ backgroundColor: AZUL }}
                  className={cn("sticky top-0 z-20 border-l-2 border-white/40 px-2 py-1.5 font-semibold", comparativo ? "text-center" : "text-right")}>
                  Total
                </th>
              )}
            </tr>
            {comparativo && (
              <tr className="bg-[#0000C2] text-white/80 [&>th]:sticky [&>th]:top-8 [&>th]:z-20">
                {mesesVis.map((m, i) => <MiniCabecalho key={m} alt={i % 2 === 1} />)}
                {mostrarTotal && <MiniCabecalho />}
              </tr>
            )}
          </thead>
          <tbody>
            {carregando
              ? <tr><td colSpan={nCols} className="px-3 py-8 text-center text-[var(--text-muted)]">Carregando…</td></tr>
              : arvore.length === 0
              ? <tr><td colSpan={nCols} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  {busca ? `Nenhuma conta com “${busca}”.` : "Sem lançamentos para o filtro escolhido."}
                </td></tr>
              : renderLinhas()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
