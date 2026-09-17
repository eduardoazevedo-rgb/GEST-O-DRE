"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatGrade, listarMeses, rotuloMes, somarMeses } from "@/lib/fluxo-caixa";

// Mesma identidade da Visão.
const AZUL = "#0000C2";
const ZEBRA = "bg-[#F1F2F6] dark:bg-neutral-800";
const HOVER = "hover:bg-[#EDEDFA] dark:hover:bg-[#191934]";
const HOVER_FIXA = "group-hover:bg-[#EDEDFA] dark:group-hover:bg-[#191934]";
const COL_TOTAL = "border-l-2 border-slate-300 bg-black/[0.03] dark:border-slate-600 dark:bg-white/[0.04]";

// Mesmos grupos do Previsto × Sistema (a regra de cada um está em fc_erp_base).
const GRUPOS = [
  { id: "recebimentos", nome: "Recebimentos de clientes", quem: "clientes", um: "cliente", regra: "Títulos a receber: contas, cartão e cheque" },
  { id: "fornecedores", nome: "Pagamento a fornecedores", quem: "fornecedores", um: "fornecedor", regra: "Contas a pagar, fora os grupos abaixo" },
  { id: "estrategicos", nome: "Fornecedores estratégicos", quem: "fornecedores", um: "fornecedor", regra: "Códigos do campo \"Códigos no ERP\" dos lançamentos: pagamentos e créditos concedidos" },
  { id: "financiamentos", nome: "Financiamentos e consórcios", quem: "credores", um: "credor", regra: "Empréstimos (tipos 18, 19) e consórcios (41 a 43)" },
  { id: "investimentos", nome: "Investimentos (imobilizado)", quem: "fornecedores", um: "fornecedor", regra: "Contas a pagar – imobilizado (tipo 34)" },
] as const;
type GrupoId = (typeof GRUPOS)[number]["id"];

const POR_PAGINA = 30;

interface Pessoa {
  cd_pessoa: number; nome: string; lado: "receber" | "pagar";
  valores: Map<string, number>; qtds: Map<string, number>; atraso: number; qtdAtraso: number;
}
interface PessoasGrupo { linhas: Pessoa[]; total: number; carregando: boolean }
interface LinhaErp { mes: string; grupo: GrupoId; situacao: "realizado" | "aberto"; valor: number }

const mesAtual = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`; };
const paraMapa = (o: unknown) => new Map(Object.entries((o ?? {}) as Record<string, number | string>).map(([k, v]) => [k, Number(v)]));
const arred = (v: number) => Math.round(v * 100) / 100;

export default function RealizadoErp({ empresaId }: { empresaId: number }) {
  const supabase = useMemo(() => createClient(), []);
  const hoje = mesAtual();
  const inicioAno = `${hoje.slice(0, 4)}-01-01`;
  const opcoes = listarMeses("2025-01-01", somarMeses(hoje, 48));

  const [de, setDe] = useState(inicioAno);
  const [ate, setAte] = useState(somarMeses(inicioAno, 11));
  const [milhares, setMilhares] = useState(true);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [grade, setGrade] = useState<LinhaErp[]>([]);
  const [sincronizado, setSincronizado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [abertos, setAbertos] = useState<Set<GrupoId>>(new Set());
  // Clientes/fornecedores carregados, marcados com o filtro em que foram pedidos:
  // resposta que chega depois de mudar período ou busca é descartada.
  const chave = `${empresaId}|${de}|${ate}|${buscaAplicada}`;
  const [carregados, setCarregados] = useState<{ chave: string; grupos: Partial<Record<GrupoId, PessoasGrupo>> }>({ chave: "", grupos: {} });
  const pessoas = carregados.chave === chave ? carregados.grupos : {};

  const meses = useMemo(() => (de <= ate ? listarMeses(de, ate) : []), [de, ate]);

  // Busca só dispara depois de uma pausa na digitação.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);

  // Totais dos grupos, mês a mês.
  useEffect(() => {
    if (empresaId !== 1 || de > ate) { setCarregando(false); return; }
    let vivo = true;
    (async () => {
      setCarregando(true); setErro("");
      const [g, sinc] = await Promise.all([
        supabase.rpc("fc_cruzamento_erp", { p_empresa: empresaId, p_de: de, p_ate: ate }),
        supabase.from("fc_erp_titulos_resumo").select("sincronizado_em").eq("empresa_id", empresaId)
          .order("sincronizado_em", { ascending: false }).limit(1),
      ]);
      if (!vivo) return;
      const falha = g.error ?? sinc.error;
      if (falha) { setErro(falha.message); setCarregando(false); return; }
      setGrade(((g.data ?? []) as { mes: string; grupo: GrupoId; situacao: LinhaErp["situacao"]; valor: number | string }[])
        .map((r) => ({ mes: r.mes.slice(0, 10), grupo: r.grupo, situacao: r.situacao, valor: Number(r.valor) })));
      setSincronizado((sinc.data?.[0] as { sincronizado_em?: string } | undefined)?.sincronizado_em ?? null);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [supabase, empresaId, de, ate]);

  async function buscarPessoas(grupo: GrupoId | null, offset: number) {
    const { data, error } = await supabase.rpc("fc_erp_grupo_pessoas", {
      p_empresa: empresaId, p_de: de, p_ate: ate, p_grupo: grupo,
      p_busca: buscaAplicada || null, p_limite: POR_PAGINA, p_offset: offset,
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
      grupo: x.grupo as GrupoId,
      total: Number(x.total_pessoas),
      pessoa: {
        cd_pessoa: Number(x.cd_pessoa), nome: String(x.nome), lado: x.lado as Pessoa["lado"],
        valores: paraMapa(x.valores), qtds: paraMapa(x.qtds), atraso: Number(x.atraso), qtdAtraso: Number(x.qtd_atraso),
      } satisfies Pessoa,
    }));
  }

  function atualizarGrupo(k: string, g: GrupoId, muda: (atual: PessoasGrupo) => PessoasGrupo) {
    setCarregados((c) => {
      const base = c.chave === k ? c.grupos : {};
      return { chave: k, grupos: { ...base, [g]: muda(base[g] ?? { linhas: [], total: 0, carregando: false }) } };
    });
  }

  async function carregarGrupo(g: GrupoId, offset: number) {
    const k = chave;
    atualizarGrupo(k, g, (a) => ({ ...a, carregando: true }));
    try {
      const linhas = await buscarPessoas(g, offset);
      setCarregados((c) => {
        if (c.chave !== k) return c;
        const a = c.grupos[g];
        return {
          chave: k,
          grupos: {
            ...c.grupos,
            [g]: {
              linhas: [...(offset === 0 ? [] : a?.linhas ?? []), ...linhas.map((l) => l.pessoa)],
              total: linhas[0]?.total ?? (offset === 0 ? 0 : a?.total ?? 0),
              carregando: false,
            },
          },
        };
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCarregados((c) => (c.chave !== k || !c.grupos[g] ? c : { chave: k, grupos: { ...c.grupos, [g]: { ...c.grupos[g]!, carregando: false } } }));
    }
  }

  // Período ou busca mudou: recarrega os clientes/fornecedores. Com busca, um
  // pedido só traz os resultados de todos os grupos e abre os que têm algum.
  useEffect(() => {
    if (empresaId !== 1 || de > ate) return;
    if (!buscaAplicada) {
      abertos.forEach((g) => { carregarGrupo(g, 0); });
      return;
    }
    let vivo = true;
    const k = chave;
    GRUPOS.forEach((g) => atualizarGrupo(k, g.id, () => ({ linhas: [], total: 0, carregando: true })));
    buscarPessoas(null, 0)
      .then((linhas) => {
        if (!vivo) return;
        const novo: Partial<Record<GrupoId, PessoasGrupo>> = Object.fromEntries(GRUPOS.map((g) => [g.id, { linhas: [], total: 0, carregando: false }]));
        for (const l of linhas) { novo[l.grupo]!.linhas.push(l.pessoa); novo[l.grupo]!.total = l.total; }
        setCarregados({ chave: k, grupos: novo });
        setAbertos(new Set(GRUPOS.filter((g) => novo[g.id]!.total > 0).map((g) => g.id)));
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof Error ? e.message : String(e));
        setCarregados({ chave: k, grupos: {} });
      });
    return () => { vivo = false; };
    // Só reage à troca de filtro; os grupos abertos são lidos no momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  // Valor de cada grupo no mês pela mesma regra das pessoas; em atraso à parte.
  const calc = useMemo(() => {
    const porGrupo = new Map<GrupoId, Map<string, number>>();
    const atraso = new Map<GrupoId, number>();
    for (const r of grade) {
      const naGrade = r.mes === hoje || (r.mes < hoje ? r.situacao === "realizado" : r.situacao === "aberto");
      if (naGrade) {
        const m = porGrupo.get(r.grupo) ?? porGrupo.set(r.grupo, new Map()).get(r.grupo)!;
        m.set(r.mes, (m.get(r.mes) ?? 0) + r.valor);
      } else if (r.mes < hoje && r.situacao === "aberto") {
        atraso.set(r.grupo, (atraso.get(r.grupo) ?? 0) + r.valor);
      }
    }
    return { porGrupo, atraso };
  }, [grade, hoje]);

  if (empresaId !== 1) {
    return <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
      Esta visão está disponível só para a renovadora (empresas 1000 a 1024) por enquanto.
    </p>;
  }

  function alternar(g: GrupoId) {
    const abrir = !abertos.has(g);
    setAbertos((prev) => { const n = new Set(prev); if (abrir) n.add(g); else n.delete(g); return n; });
    if (abrir && !pessoas[g]) carregarGrupo(g, 0);
  }

  function alternarTodos() {
    if (abertos.size === GRUPOS.length) { setAbertos(new Set()); return; }
    setAbertos(new Set(GRUPOS.map((g) => g.id)));
    for (const g of GRUPOS) if (!pessoas[g.id]) carregarGrupo(g.id, 0);
  }

  const somaVis = (m: Map<string, number> | undefined) => meses.reduce((s, x) => s + (m?.get(x) ?? 0), 0);
  const cel = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
  const vazio = <span className="text-[var(--text-muted)]/40">–</span>;
  const numero = (v: number | null | undefined) =>
    v == null || v === 0 ? vazio : (
      <span className={cn(v > 0 && "text-emerald-600 dark:text-emerald-400")}>{formatGrade(v, milhares)}</span>
    );
  const numeroAtraso = (v: number) =>
    v === 0 ? vazio : <span className="text-amber-700 dark:text-amber-300">{formatGrade(v, milhares)}</span>;

  function linha(opts: {
    chave: string; nome: ReactNode; valores?: Map<string, number>; atraso: number; nivel: 0 | 1 | "total";
    zebra?: boolean; primeiro?: boolean; onClick?: () => void; titulo?: string; qtds?: Map<string, number>; qtdAtraso?: number;
  }) {
    const total = somaVis(opts.valores);
    const bg = opts.zebra ? ZEBRA : "bg-[var(--surface)]";
    const eTotal = opts.nivel === "total";
    return (
      <tr key={opts.chave} onClick={opts.onClick}
        className={cn("group", opts.zebra && ZEBRA, HOVER, opts.onClick && "cursor-pointer",
          opts.nivel === 0 ? "border-t border-slate-300 font-bold dark:border-slate-600"
            : eTotal ? cn("border-t border-slate-300 font-extrabold dark:border-slate-600", opts.primeiro && "border-t-2") : "border-t border-[var(--border)]")}>
        <td className={cn("sticky left-0 z-10 max-w-[24rem] truncate whitespace-nowrap py-1.5 pr-3 shadow-[2px_0_4px_rgba(0,0,0,0.05)]", bg, HOVER_FIXA,
          opts.nivel === 1 && "font-normal text-[var(--text-muted)]", eTotal && "py-2 uppercase tracking-wide")}
          style={{ paddingLeft: opts.nivel === 1 ? 36 : 12 }} title={opts.titulo}>
          {opts.nome}
        </td>
        {meses.map((m) => {
          const q = opts.qtds?.get(m);
          return <td key={m} className={cn(cel, eTotal && "py-2")} title={q ? `${q} título(s)` : undefined}>{numero(opts.valores?.get(m))}</td>;
        })}
        <td className={cn(cel, COL_TOTAL, "font-bold")}>{numero(total)}</td>
        <td className={cn(cel, "border-l border-slate-300 dark:border-slate-600", eTotal && "py-2")}
          title={opts.qtdAtraso ? `${opts.qtdAtraso} título(s)` : undefined}>
          {numeroAtraso(opts.atraso)}
        </td>
      </tr>
    );
  }

  const linhaAviso = (chave: string, conteudo: ReactNode, onClick?: () => void) => (
    <tr key={chave} onClick={onClick} className={cn("border-t border-[var(--border)]", onClick && cn("cursor-pointer", HOVER))}>
      <td colSpan={meses.length + 3} className="py-2 pl-9 text-xs text-[var(--text-muted)]">{conteudo}</td>
    </tr>
  );

  const linhas: ReactNode[] = [];
  GRUPOS.forEach((g, i) => {
    const aberto = abertos.has(g.id);
    const valores = calc.porGrupo.get(g.id);
    const atraso = calc.atraso.get(g.id) ?? 0;
    linhas.push(linha({
      chave: `g-${g.id}`, nivel: 0, zebra: i % 2 === 1, valores, atraso, onClick: () => alternar(g.id), titulo: `No ERP: ${g.regra}`,
      nome: <span className="inline-flex items-center gap-1">{aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{g.nome}</span>,
    }));
    if (!aberto) return;

    const pg = pessoas[g.id];
    const lista = pg?.linhas ?? [];
    for (const p of lista) {
      linhas.push(linha({
        chave: `p-${g.id}-${p.cd_pessoa}-${p.lado}`, nivel: 1, valores: p.valores, qtds: p.qtds, atraso: p.atraso, qtdAtraso: p.qtdAtraso,
        titulo: `${p.cd_pessoa} · ${p.nome}`,
        nome: (
          <>
            <span className="mr-1 tabular-nums text-[var(--text-muted)]/70">{p.cd_pessoa}</span>
            {p.nome}
            {g.id === "estrategicos" && p.lado === "receber" && (
              <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">crédito</span>
            )}
          </>
        ),
      }));
    }

    if (!pg || (pg.carregando && lista.length === 0)) {
      linhas.push(linhaAviso(`c-${g.id}`, <><Loader2 size={12} className="mr-1 inline animate-spin" />carregando {g.quem}…</>));
      return;
    }
    const faltam = pg.total - lista.length;
    if (faltam > 0) {
      const maisUma = () => { if (!pg.carregando) carregarGrupo(g.id, lista.length); };
      const rotulo = (
        <span className="inline-flex items-center gap-1.5">
          {buscaAplicada ? `Mais ${faltam.toLocaleString("pt-BR")} resultado(s)` : `Demais ${faltam.toLocaleString("pt-BR")} ${g.quem}`}
          <span className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[10px] font-semibold not-italic text-[var(--text)]">
            {pg.carregando ? <Loader2 size={10} className="inline animate-spin" /> : `+ ${Math.min(POR_PAGINA, faltam)}`}
          </span>
        </span>
      );
      if (buscaAplicada) {
        linhas.push(linhaAviso(`m-${g.id}`, rotulo, maisUma));
      } else {
        // O que ainda não foi aberto nome a nome: total do grupo menos os já listados.
        const resto = new Map<string, number>();
        for (const m of meses) resto.set(m, arred((valores?.get(m) ?? 0) - lista.reduce((s, p) => s + (p.valores.get(m) ?? 0), 0)));
        const restoAtraso = arred(atraso - lista.reduce((s, p) => s + p.atraso, 0));
        linhas.push(linha({ chave: `r-${g.id}`, nivel: 1, valores: resto, atraso: restoAtraso, onClick: maisUma, nome: <i>{rotulo}</i> }));
      }
    } else if (pg.total === 0) {
      linhas.push(linhaAviso(`v-${g.id}`, buscaAplicada ? "Nenhum resultado para a busca neste grupo." : `Nenhum ${g.um} com movimento neste período.`));
    }
  });

  const saidas = GRUPOS.filter((g) => g.id !== "recebimentos").map((g) => g.id);
  const somaGrupos = (ids: GrupoId[]) => {
    const m = new Map<string, number>();
    for (const id of ids) calc.porGrupo.get(id)?.forEach((v, k) => m.set(k, (m.get(k) ?? 0) + v));
    return { valores: m, atraso: ids.reduce((s, id) => s + (calc.atraso.get(id) ?? 0), 0) };
  };
  const totais = [
    { id: "entradas", nome: "Entradas", ...somaGrupos(["recebimentos"]) },
    { id: "saidas", nome: "Saídas", ...somaGrupos(saidas) },
    { id: "liquido", nome: "Geração de caixa", ...somaGrupos(GRUPOS.map((g) => g.id)) },
  ];

  const sel = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]";
  const subMes = (m: string) => (m < hoje ? "realizado" : m > hoje ? "a vencer" : "real. + aberto");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="rz-de">De</label>
        <select id="rz-de" value={de} onChange={(e) => setDe(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <label className="text-xs text-[var(--text-muted)]" htmlFor="rz-ate">até</label>
        <select id="rz-ate" value={ate} onChange={(e) => setAte(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <button onClick={alternarTodos}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
          {abertos.size === GRUPOS.length ? "Recolher grupos" : "Abrir todos os grupos"}
        </button>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input id="rz-busca" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente ou fornecedor (nome ou código)"
            className="w-80 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-7 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]" />
          {busca && (
            <button onClick={() => setBusca("")} title="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]">
              <X size={13} />
            </button>
          )}
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          {sincronizado ? `ERP sincronizado em ${new Date(sincronizado).toLocaleString("pt-BR")}` : "ERP ainda não sincronizado"}
        </span>
        <button onClick={() => setMilhares((v) => !v)}
          className={cn("ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            milhares ? "border-[var(--primary)] bg-[var(--primary)] text-white"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]")}>
          R$ mil {milhares ? "•" : ""}
        </button>
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      {meses.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">O mês inicial precisa ser anterior ao final.</p>
      ) : (
        <div className={cn("max-h-[calc(100vh-17rem)] min-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]", carregando && "opacity-60")}>
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-white">
                <th style={{ backgroundColor: AZUL }} className="sticky left-0 top-0 z-30 min-w-72 px-3 py-2 text-left font-semibold">
                  Grupo / cliente ou fornecedor {milhares && <span className="font-normal opacity-75">· R$ mil</span>}
                </th>
                {meses.map((m) => (
                  <th key={m} style={{ backgroundColor: AZUL }} className="sticky top-0 z-20 border-l border-white/20 px-2 py-1.5 text-right font-semibold">
                    {rotuloMes(m)}
                    <span className="block text-[10px] font-normal opacity-75">{subMes(m)}</span>
                  </th>
                ))}
                <th style={{ backgroundColor: AZUL }} className="sticky top-0 z-20 border-l-2 border-white/40 px-2 py-1.5 text-right font-semibold">
                  Total
                  <span className="block text-[10px] font-normal opacity-75">do período</span>
                </th>
                <th style={{ backgroundColor: AZUL }} className="sticky top-0 z-20 border-l border-white/40 px-2 py-1.5 text-right font-semibold">
                  Em atraso
                  <span className="block text-[10px] font-normal opacity-75">venceu e segue aberto</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => <Fragment key={i}>{l}</Fragment>)}
              {totais.map((t, i) => linha({ chave: `t-${t.id}`, nivel: "total", primeiro: i === 0, valores: t.valores, atraso: t.atraso, nome: t.nome }))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Dados do ERP, só empresas 1000 a 1024. Meses passados: o que foi pago e recebido (títulos baixados, pelo mês da baixa e valor do documento);
        mês atual: o realizado mais o que ainda vence no mês; meses futuros: títulos em aberto pelo vencimento. <b>Em atraso</b>: venceu em mês
        passado do período e segue em aberto. Clique num grupo para abrir os clientes e fornecedores, dos maiores para os menores; a linha
        &quot;Demais&quot; traz o restante do grupo e carrega mais nomes. Ficam fora: títulos reparcelados (status A), incobráveis, adiantamentos e provisões.
      </p>
    </div>
  );
}
