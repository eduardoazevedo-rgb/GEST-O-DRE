"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  formatGrade, formatReais, listarMeses, mesDe, rotuloMes, somarMeses,
  type Lancamento, type Premissa,
} from "@/lib/fluxo-caixa";

// Cada linha do cruzamento junta blocos do controle manual e o grupo
// correspondente no ERP (a regra de cada grupo está em fc_cruzamento_erp).
const GRUPOS = [
  { id: "recebimentos", rotulo: "Recebimentos de clientes", blocos: ["recebimentos"], erp: "Títulos a receber: contas, cartão e cheque" },
  { id: "fornecedores", rotulo: "Fornecedores gerais", blocos: ["fornecedores", "seguros", "pessoal", "tributos"], erp: "Contas a pagar, fora os grupos abaixo" },
  { id: "estrategicos", rotulo: "Fornecedores estratégicos", blocos: ["estrategicos"], erp: "Fornecedores com código no campo \"Códigos no ERP\" dos lançamentos" },
  { id: "financiamentos", rotulo: "Financiamentos", blocos: ["financiamentos"], erp: "Empréstimos (tipos 18, 19) e consórcios (41 a 43)" },
  { id: "investimentos", rotulo: "Investimentos, veículos e SSMA", blocos: ["investimentos", "veiculos", "ssma"], erp: "Contas a pagar – imobilizado (tipo 34)" },
] as const;
type GrupoId = (typeof GRUPOS)[number]["id"];
const GRUPO_DO_BLOCO = new Map<string, GrupoId>(GRUPOS.flatMap((g) => g.blocos.map((b) => [b, g.id] as const)));

const AZUL = "#0000C2";
const AZUL_ALT = "#1A1AD1";
const TOLERANCIA = 0.05; // ±5%: dentro disso a previsão é considerada aderente
const POR_PAGINA = 20;   // clientes/fornecedores por vez ao abrir um grupo

interface LinhaErp { mes: string; grupo: GrupoId; situacao: "realizado" | "aberto"; qtd: number; valor: number }
interface PessoaErp { cd_pessoa: number; nome: string; lado: "receber" | "pagar"; valores: Map<string, number> }
interface PessoasGrupo { linhas: PessoaErp[]; total: number; carregando: boolean }

interface Props {
  empresaId: number;
  lancamentos: Lancamento[];
  premissas: Premissa[];
}

const mesAtual = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`; };

export default function CruzamentoErp({ empresaId, lancamentos, premissas }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const hoje = mesAtual();
  const inicioAno = `${hoje.slice(0, 4)}-01-01`;
  const opcoes = listarMeses("2025-01-01", somarMeses(hoje, 24));

  const [de, setDe] = useState(inicioAno);
  const [ate, setAte] = useState(somarMeses(hoje, 5));
  const [milhares, setMilhares] = useState(true);
  const [erp, setErp] = useState<LinhaErp[]>([]);
  const [vencidos, setVencidos] = useState<{ receber: number; pagar: number }>({ receber: 0, pagar: 0 });
  const [sincronizado, setSincronizado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  // Quem está por trás do número do sistema, carregado só quando o grupo abre.
  const [abertos, setAbertos] = useState<Set<GrupoId>>(new Set());
  const chavePessoas = `${empresaId}|${de}|${ate}`;
  const [carregados, setCarregados] = useState<{ chave: string; grupos: Partial<Record<GrupoId, PessoasGrupo>> }>({ chave: "", grupos: {} });
  const pessoas = carregados.chave === chavePessoas ? carregados.grupos : {};

  const meses = useMemo(() => (de <= ate ? listarMeses(de, ate) : []), [de, ate]);

  useEffect(() => {
    if (empresaId !== 1 || meses.length === 0) { setCarregando(false); return; }
    let vivo = true;
    (async () => {
      setCarregando(true); setErro("");
      const antes = somarMeses(hoje, -1);
      const [grade, atrasados, sinc] = await Promise.all([
        supabase.rpc("fc_cruzamento_erp", { p_empresa: empresaId, p_de: de, p_ate: ate }),
        supabase.rpc("fc_cruzamento_erp", { p_empresa: empresaId, p_de: "2000-01-01", p_ate: antes }),
        supabase.from("fc_erp_titulos_resumo").select("sincronizado_em").eq("empresa_id", empresaId)
          .order("sincronizado_em", { ascending: false }).limit(1),
      ]);
      if (!vivo) return;
      const falha = grade.error ?? atrasados.error ?? sinc.error;
      if (falha) { setErro(falha.message); setCarregando(false); return; }
      const norm = (rows: unknown[] | null) => (rows ?? []).map((r) => {
        const x = r as { mes: string; grupo: GrupoId; situacao: "realizado" | "aberto"; qtd: number | string; valor: number | string };
        return { mes: x.mes.slice(0, 10), grupo: x.grupo, situacao: x.situacao, qtd: Number(x.qtd), valor: Number(x.valor) };
      });
      setErp(norm(grade.data));
      const abertosAntigos = norm(atrasados.data).filter((r) => r.situacao === "aberto");
      setVencidos({
        receber: abertosAntigos.filter((r) => r.grupo === "recebimentos").reduce((s, r) => s + r.valor, 0),
        pagar: abertosAntigos.filter((r) => r.grupo !== "recebimentos").reduce((s, r) => s + r.valor, 0),
      });
      setSincronizado((sinc.data?.[0] as { sincronizado_em?: string } | undefined)?.sincronizado_em ?? null);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [supabase, empresaId, de, ate, hoje, meses.length]);

  // Previsto manual por grupo e mês (mesma base da Visão: parcelas ativas + premissas).
  const previsto = useMemo(() => {
    const m = new Map<string, number>();
    const somar = (g: GrupoId | undefined, mes: string, v: number) => { if (g) m.set(`${g}|${mes}`, (m.get(`${g}|${mes}`) ?? 0) + v); };
    for (const l of lancamentos) {
      if (l.status === "cancelado") continue;
      for (const p of l.parcelas) somar(GRUPO_DO_BLOCO.get(l.bloco_id), mesDe(p.vencimento), p.valor);
    }
    for (const p of premissas) somar(p.tipo === "clientes" ? "recebimentos" : "fornecedores", p.mes, p.valor);
    return m;
  }, [lancamentos, premissas]);

  // Sistema: mês passado = realizado; mês atual = realizado + ainda em aberto no mês; futuro = já lançado.
  const sistema = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of erp) {
      const conta = r.mes < hoje ? r.situacao === "realizado" : r.mes > hoje ? r.situacao === "aberto" : true;
      if (conta) m.set(`${r.grupo}|${r.mes}`, (m.get(`${r.grupo}|${r.mes}`) ?? 0) + r.valor);
    }
    return m;
  }, [erp, hoje]);

  const rotuloSistema = (mes: string) => (mes < hoje ? "Realizado" : mes > hoje ? "No ERP" : "Real.+aberto");

  async function carregarGrupo(g: GrupoId, offset: number) {
    const k = chavePessoas;
    setCarregados((c) => {
      const base = c.chave === k ? c.grupos : {};
      return { chave: k, grupos: { ...base, [g]: { linhas: base[g]?.linhas ?? [], total: base[g]?.total ?? 0, carregando: true } } };
    });
    const { data, error } = await supabase.rpc("fc_erp_grupo_pessoas", {
      p_empresa: empresaId, p_de: de, p_ate: ate, p_grupo: g, p_busca: null, p_limite: POR_PAGINA, p_offset: offset,
    });
    if (error) {
      setErro(error.message);
      setCarregados((c) => (c.chave !== k || !c.grupos[g] ? c : { chave: k, grupos: { ...c.grupos, [g]: { ...c.grupos[g]!, carregando: false } } }));
      return;
    }
    const linhas = (data ?? []) as Record<string, unknown>[];
    setCarregados((c) => {
      if (c.chave !== k) return c;
      const atual = c.grupos[g];
      const novas = linhas.map((x) => ({
        cd_pessoa: Number(x.cd_pessoa), nome: String(x.nome), lado: x.lado as PessoaErp["lado"],
        valores: new Map(Object.entries((x.valores ?? {}) as Record<string, number | string>).map(([m, v]) => [m, Number(v)])),
      }));
      return {
        chave: k,
        grupos: {
          ...c.grupos,
          [g]: {
            linhas: [...(offset === 0 ? [] : atual?.linhas ?? []), ...novas],
            total: linhas[0] ? Number(linhas[0].total_pessoas) : (offset === 0 ? 0 : atual?.total ?? 0),
            carregando: false,
          },
        },
      };
    });
  }

  function alternar(g: GrupoId) {
    const abrir = !abertos.has(g);
    setAbertos((prev) => { const n = new Set(prev); if (abrir) n.add(g); else n.delete(g); return n; });
    if (abrir && !pessoas[g]) carregarGrupo(g, 0);
  }

  // Trocou o período: recarrega os grupos que estão abertos.
  useEffect(() => {
    if (empresaId !== 1 || de > ate) return;
    abertos.forEach((g) => { carregarGrupo(g, 0); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chavePessoas]);

  // Linha de um cliente/fornecedor: só a coluna do sistema tem valor.
  function linhaPessoa(chave: string, nome: ReactNode, valores: Map<string, number>, onClick?: () => void) {
    const cel = "px-2 py-1 text-right tabular-nums whitespace-nowrap";
    const vazio = <span className="text-[var(--text-muted)]/40">–</span>;
    return (
      <tr key={chave} onClick={onClick}
        className={cn("group border-t border-[var(--border)] hover:bg-[#EDEDFA] dark:hover:bg-[#191934]", onClick && "cursor-pointer")}>
        <td className="sticky left-0 z-10 max-w-[22rem] truncate whitespace-nowrap bg-[var(--surface)] py-1 pl-8 pr-3 text-[var(--text-muted)] shadow-[2px_0_4px_rgba(0,0,0,0.05)] group-hover:bg-[#EDEDFA] dark:group-hover:bg-[#191934]">
          {nome}
        </td>
        {meses.map((mes, i) => {
          const zebra = i % 2 === 1 && "bg-black/[0.015] dark:bg-white/[0.02]";
          const v = valores.get(mes) ?? 0;
          return (
            <Fragment key={mes}>
              <td className={cn(cel, "border-l-2 border-slate-200 dark:border-slate-700", zebra)} />
              <td className={cn(cel, zebra)}>{v ? formatGrade(v, milhares) : vazio}</td>
              <td className={cn(cel, "pr-3", zebra)} />
            </Fragment>
          );
        })}
      </tr>
    );
  }

  function linhasDoGrupo(g: (typeof GRUPOS)[number]) {
    const pg = pessoas[g.id];
    const lista = pg?.linhas ?? [];
    const quem = g.id === "recebimentos" ? "clientes" : "fornecedores";
    const fora: ReactNode[] = lista.map((p) => linhaPessoa(
      `pe-${g.id}-${p.cd_pessoa}-${p.lado}`,
      <>
        <span className="mr-1 tabular-nums opacity-70">{p.cd_pessoa}</span>{p.nome}
        {g.id === "estrategicos" && p.lado === "receber" && (
          <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">crédito</span>
        )}
      </>,
      p.valores,
    ));
    if (!pg || (pg.carregando && lista.length === 0)) {
      fora.push(
        <tr key={`c-${g.id}`} className="border-t border-[var(--border)]">
          <td colSpan={meses.length * 3 + 1} className="py-2 pl-8 text-xs text-[var(--text-muted)]">
            <Loader2 size={12} className="mr-1 inline animate-spin" />carregando {quem} do ERP…
          </td>
        </tr>
      );
      return fora;
    }
    const faltam = pg.total - lista.length;
    if (faltam > 0) {
      // O restante do grupo, para a soma das linhas fechar com o total.
      const resto = new Map<string, number>();
      for (const m of meses) {
        const total = sistema.get(`${g.id}|${m}`) ?? 0;
        resto.set(m, Math.round((total - lista.reduce((acc, p) => acc + (p.valores.get(m) ?? 0), 0)) * 100) / 100);
      }
      fora.push(linhaPessoa(`r-${g.id}`,
        <span className="inline-flex items-center gap-1.5 italic">
          Demais {faltam.toLocaleString("pt-BR")} {quem}
          <span className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[10px] font-semibold not-italic text-[var(--text)]">
            {pg.carregando ? <Loader2 size={10} className="inline animate-spin" /> : `+ ${Math.min(POR_PAGINA, faltam)}`}
          </span>
        </span>,
        resto,
        () => { if (!pg.carregando) carregarGrupo(g.id, lista.length); }));
    } else if (pg.total === 0) {
      fora.push(
        <tr key={`v-${g.id}`} className="border-t border-[var(--border)]">
          <td colSpan={meses.length * 3 + 1} className="py-2 pl-8 text-xs text-[var(--text-muted)]">Nenhum título do ERP neste grupo e período.</td>
        </tr>
      );
    }
    return fora;
  }

  function celulas(chaveGrupo: (mes: string) => string[], negrito = false) {
    return meses.map((mes, i) => {
      const chaves = chaveGrupo(mes);
      const p = chaves.reduce((s, k) => s + (previsto.get(k) ?? 0), 0);
      const s = chaves.reduce((acc, k) => acc + (sistema.get(k) ?? 0), 0);
      const dif = s - p;
      const rel = p !== 0 ? Math.abs(dif) / Math.abs(p) : dif === 0 ? 0 : 1;
      const aderente = rel <= TOLERANCIA;
      // Mês futuro: as notas ainda não chegaram, então a diferença não é erro —
      // mostra quanto da previsão já está lançado no ERP.
      const futuro = mes > hoje;
      // Com sinais opostos (ex.: previsto de entrada, ERP com saída) a razão não significa nada.
      const cobertura = p !== 0 && (s === 0 || Math.sign(s) === Math.sign(p)) ? Math.round((Math.abs(s) / Math.abs(p)) * 100) : null;
      const cel = cn("px-2 py-1.5 text-right tabular-nums whitespace-nowrap", negrito && "font-bold");
      const vazio = <span className="text-[var(--text-muted)]/40">–</span>;
      return (
        <Fragment key={mes}>
          <td className={cn(cel, "border-l-2 border-slate-200 text-[var(--text-muted)] dark:border-slate-700", i % 2 === 1 && "bg-black/[0.015] dark:bg-white/[0.02]")}>
            {p ? formatGrade(p, milhares) : vazio}
          </td>
          <td className={cn(cel, i % 2 === 1 && "bg-black/[0.015] dark:bg-white/[0.02]")}>{s ? formatGrade(s, milhares) : vazio}</td>
          {futuro ? (
            <td title={cobertura != null ? `${formatReais(Math.abs(s))} já lançado de ${formatReais(Math.abs(p))} previsto` : undefined}
              className={cn(cel, "pr-3 font-normal text-[var(--text-muted)]", i % 2 === 1 && "bg-black/[0.015] dark:bg-white/[0.02]")}>
              {cobertura != null ? `${cobertura}%` : vazio}
            </td>
          ) : (
            <td title={p ? `${dif >= 0 ? "+" : ""}${formatReais(dif)} (${(rel * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do previsto)` : undefined}
              className={cn(cel, "pr-3", i % 2 === 1 && "bg-black/[0.015] dark:bg-white/[0.02]",
                !p && !s ? "" : aderente ? "text-[var(--text-muted)]" : dif > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {!p && !s ? vazio : aderente ? "≈" : `${dif > 0 ? "+" : ""}${formatGrade(dif, milhares)}`}
            </td>
          )}
        </Fragment>
      );
    });
  }

  if (empresaId !== 1) {
    return <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
      O cruzamento com o ERP está disponível só para a renovadora (empresas 1000 a 1024) por enquanto.
    </p>;
  }

  const saidas = GRUPOS.filter((g) => g.id !== "recebimentos").map((g) => g.id);
  const sel = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="cz-de">De</label>
        <select id="cz-de" value={de} onChange={(e) => setDe(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <label className="text-xs text-[var(--text-muted)]" htmlFor="cz-ate">até</label>
        <select id="cz-ate" value={ate} onChange={(e) => setAte(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <span className="text-xs text-[var(--text-muted)]">
          {sincronizado ? `ERP sincronizado em ${new Date(sincronizado).toLocaleString("pt-BR")}` : "ERP ainda não sincronizado"}
        </span>
        <button onClick={() => setMilhares((v) => !v)}
          className={cn("ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            milhares ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]")}>
          R$ mil {milhares ? "•" : ""}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Vencidos e não recebidos (meses anteriores): <b className="tabular-nums">R$ {formatReais(vencidos.receber)}</b>
        </span>
        <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Vencidos e não pagos (meses anteriores): <b className="tabular-nums">R$ {formatReais(Math.abs(vencidos.pagar))}</b>
        </span>
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      {meses.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--text-muted)]">O mês inicial precisa ser anterior ao final.</p>
      ) : (
        <div className={cn("max-h-[calc(100vh-19rem)] min-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]", carregando && "opacity-60")}>
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-white">
                <th rowSpan={2} style={{ backgroundColor: AZUL }} className="sticky left-0 top-0 z-30 min-w-64 px-3 py-2 text-left font-semibold">
                  Grupo {milhares && <span className="font-normal opacity-75">· R$ mil</span>}
                </th>
                {meses.map((m, i) => (
                  <th key={m} colSpan={3} style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }}
                    className={cn("sticky top-0 z-20 border-l-2 border-white/25 px-2 py-1.5 text-center font-semibold", m === hoje && "underline decoration-2 underline-offset-4")}>
                    {rotuloMes(m)}
                  </th>
                ))}
              </tr>
              <tr className="text-white/80">
                {meses.map((m, i) => (
                  <Fragment key={m}>
                    <th style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }} className="sticky top-8 z-20 border-l-2 border-white/25 px-2 py-1 text-right font-normal">Previsto</th>
                    <th style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }} className="sticky top-8 z-20 px-2 py-1 text-right font-normal">{rotuloSistema(m)}</th>
                    <th style={{ backgroundColor: i % 2 === 1 ? AZUL_ALT : AZUL }} className="sticky top-8 z-20 px-2 py-1 pr-3 text-right font-normal">{m > hoje ? "% no ERP" : "Dif."}</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {GRUPOS.map((g, i) => (
                <Fragment key={g.id}>
                  <tr onClick={() => alternar(g.id)}
                    className={cn("group cursor-pointer border-t border-[var(--border)] hover:bg-[#EDEDFA] dark:hover:bg-[#191934]", i % 2 === 1 && "bg-[#F1F2F6] dark:bg-neutral-800")}>
                    <td className={cn("sticky left-0 z-10 px-3 py-1.5 shadow-[2px_0_4px_rgba(0,0,0,0.05)] group-hover:bg-[#EDEDFA] dark:group-hover:bg-[#191934]",
                      i % 2 === 1 ? "bg-[#F1F2F6] dark:bg-neutral-800" : "bg-[var(--surface)]")} title={`No ERP: ${g.erp}`}>
                      <div className="flex items-start gap-1">
                        {abertos.has(g.id) ? <ChevronDown size={13} className="mt-0.5 shrink-0" /> : <ChevronRight size={13} className="mt-0.5 shrink-0" />}
                        <div>
                          <div className="font-semibold text-[var(--text)]">{g.rotulo}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{g.erp}</div>
                        </div>
                      </div>
                    </td>
                    {celulas((mes) => [`${g.id}|${mes}`])}
                  </tr>
                  {abertos.has(g.id) && linhasDoGrupo(g)}
                </Fragment>
              ))}
              {[
                { id: "entradas", rotulo: "Entradas", grupos: ["recebimentos"] },
                { id: "saidas", rotulo: "Saídas", grupos: saidas },
                { id: "liquido", rotulo: "Líquido do mês", grupos: GRUPOS.map((g) => g.id) },
              ].map((t, i) => (
                <tr key={t.id} className={cn("border-t border-slate-300 dark:border-slate-600", i === 0 && "border-t-2")}>
                  <td className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-2 font-extrabold uppercase tracking-wide text-[var(--text)] shadow-[2px_0_4px_rgba(0,0,0,0.05)]">{t.rotulo}</td>
                  {celulas((mes) => t.grupos.map((g) => `${g}|${mes}`), true)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-xs text-[var(--text-muted)]">
        <p>
          <b>Previsto</b> vem do controle manual (lançamentos ativos e premissas). <b>Sistema</b>: nos meses passados, o que foi pago e recebido no ERP
          (títulos liquidados, pelo valor do documento); no mês atual, o realizado mais o que ainda vence no mês; nos meses futuros, o que já está lançado no ERP.
        </p>
        <p>
          <b>Dif.</b> (meses passados e atual) = sistema − previsto: verde é melhor para o caixa (recebeu mais ou pagou menos), vermelho é pior; <b>≈</b> indica diferença de até ±5% do previsto.
          <b>% no ERP</b> (meses futuros) = quanto da previsão já está lançado em títulos — o resto ainda é estimativa.
          Clique num grupo para abrir os clientes e fornecedores que formam a coluna do sistema, dos maiores para os menores.
          Ficam fora do ERP: títulos reparcelados (status A), incobráveis, adiantamentos e provisões. Só empresas 1000 a 1024.
        </p>
      </div>
    </div>
  );
}
