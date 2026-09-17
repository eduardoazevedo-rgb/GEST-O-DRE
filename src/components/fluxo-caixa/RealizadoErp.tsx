"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatReais, listarMeses, rotuloMes, somarMeses } from "@/lib/fluxo-caixa";

type Lado = "receber" | "pagar";

interface Pessoa {
  cd_pessoa: number; nome: string; grupo: string;
  qtd_realizado: number; realizado: number;
  qtd_vencido: number; vencido: number;
  qtd_a_vencer: number; a_vencer: number;
}
interface Totais { pessoas: number; realizado: number; vencido: number; a_vencer: number }

const POR_PAGINA = 300;
const ROTULOS: Record<Lado, { quem: string; realizado: string; vencido: string; aVencer: string }> = {
  receber: { quem: "Cliente", realizado: "Recebido", vencido: "Vencido e não recebido", aVencer: "A receber" },
  pagar: { quem: "Fornecedor", realizado: "Pago", vencido: "Vencido e não pago", aVencer: "A pagar" },
};
const COR_GRUPO: Record<string, string> = {
  "Cliente": "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200",
  "Cartão (operadora)": "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200",
  "Crédito de fornecedor": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200",
  "Estratégico": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200",
  "Empréstimo": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "Consórcio": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "Imobilizado": "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200",
  "Fornecedor": "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200",
};

const mesAtual = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`; };
const num = (v: unknown) => Number(v ?? 0);

export default function RealizadoErp({ empresaId }: { empresaId: number }) {
  const supabase = useMemo(() => createClient(), []);
  const hoje = mesAtual();
  const opcoes = listarMeses("2025-01-01", somarMeses(hoje, 48));

  const [lado, setLado] = useState<Lado>("receber");
  const [de, setDe] = useState(`${hoje.slice(0, 4)}-01-01`);
  const [ate, setAte] = useState(somarMeses(hoje, 12));
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [totais, setTotais] = useState<Totais>({ pessoas: 0, realizado: 0, vencido: 0, a_vencer: 0 });
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<{ mes: string; situacao: string; qtd: number; valor: number }[] | null>(null);

  // Busca só dispara depois de uma pausa na digitação.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);

  const r = ROTULOS[lado];

  async function buscar(desde: number) {
    const { data, error } = await supabase
      .rpc("fc_erp_por_pessoa", { p_empresa: empresaId, p_lado: lado, p_de: de, p_ate: ate, p_busca: buscaAplicada || null })
      .range(desde, desde + POR_PAGINA - 1);
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as Record<string, unknown>[];
    if (linhas[0]) {
      setTotais({
        pessoas: num(linhas[0].total_pessoas),
        realizado: num(linhas[0].total_realizado), vencido: num(linhas[0].total_vencido), a_vencer: num(linhas[0].total_a_vencer),
      });
    } else if (desde === 0) {
      setTotais({ pessoas: 0, realizado: 0, vencido: 0, a_vencer: 0 });
    }
    return linhas.map((x) => ({
      cd_pessoa: num(x.cd_pessoa), nome: String(x.nome), grupo: String(x.grupo),
      qtd_realizado: num(x.qtd_realizado), realizado: num(x.realizado),
      qtd_vencido: num(x.qtd_vencido), vencido: num(x.vencido),
      qtd_a_vencer: num(x.qtd_a_vencer), a_vencer: num(x.a_vencer),
    }));
  }

  useEffect(() => {
    if (empresaId !== 1 || de > ate) { setCarregando(false); return; }
    let vivo = true;
    setCarregando(true); setErro(""); setAberto(null); setDetalhe(null);
    buscar(0)
      .then((linhas) => { if (vivo) setPessoas(linhas); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, lado, de, ate, buscaAplicada]);

  async function carregarMais() {
    setCarregandoMais(true);
    try {
      const mais = await buscar(pessoas.length);
      setPessoas((p) => [...p, ...mais]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregandoMais(false);
    }
  }

  async function alternar(cd: number) {
    if (aberto === cd) { setAberto(null); setDetalhe(null); return; }
    setAberto(cd); setDetalhe(null);
    const { data, error } = await supabase
      .from("fc_erp_titulos_resumo")
      .select("mes, situacao, qtd, valor")
      .eq("empresa_id", empresaId).eq("lado", lado).eq("cd_pessoa", cd)
      .gte("mes", de).lte("mes", ate)
      .order("mes");
    if (error) { setErro(error.message); return; }
    const agrupado = new Map<string, { mes: string; situacao: string; qtd: number; valor: number }>();
    for (const x of (data ?? []) as { mes: string; situacao: string; qtd: number; valor: number | string }[]) {
      const k = `${x.mes}|${x.situacao}`;
      const cur = agrupado.get(k) ?? { mes: x.mes, situacao: x.situacao, qtd: 0, valor: 0 };
      cur.qtd += Number(x.qtd); cur.valor += Number(x.valor);
      agrupado.set(k, cur);
    }
    setDetalhe([...agrupado.values()]);
  }

  if (empresaId !== 1) {
    return <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
      Esta visão está disponível só para a renovadora (empresas 1000 a 1024) por enquanto.
    </p>;
  }

  const sel = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]";
  const v = (x: number) => formatReais(Math.abs(x));
  const cartao = (titulo: string, valor: number, extra: string, cor?: string) => (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</p>
      <p className={cn("text-xl font-bold tabular-nums", cor ?? "text-[var(--text)]")}>R$ {v(valor)}</p>
      <p className="text-xs text-[var(--text-muted)]">{extra}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          {(["receber", "pagar"] as const).map((l) => (
            <button key={l} onClick={() => setLado(l)}
              className={cn("rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                lado === l ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}>
              {l === "receber" ? "Clientes" : "Fornecedores"}
            </button>
          ))}
        </div>
        <label className="text-xs text-[var(--text-muted)]" htmlFor="rz-de">De</label>
        <select id="rz-de" value={de} onChange={(e) => setDe(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <label className="text-xs text-[var(--text-muted)]" htmlFor="rz-ate">até</label>
        <select id="rz-ate" value={ate} onChange={(e) => setAte(e.target.value)} className={sel}>
          {opcoes.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <div className="relative ml-auto">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input id="rz-busca" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder={`Buscar ${r.quem.toLowerCase()} por nome ou código`}
            className="w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-7 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]" />
          {busca && (
            <button onClick={() => setBusca("")} title="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {cartao(r.realizado, totais.realizado, `${totais.pessoas.toLocaleString("pt-BR")} ${lado === "receber" ? "clientes" : "fornecedores"} no filtro`,
          lado === "receber" ? "text-emerald-600 dark:text-emerald-400" : undefined)}
        {cartao(r.vencido, totais.vencido, "vencimento antes deste mês, ainda em aberto", "text-amber-700 dark:text-amber-300")}
        {cartao(r.aVencer, totais.a_vencer, "vencimento deste mês em diante")}
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      <div className={cn("max-h-[calc(100vh-22rem)] min-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]", carregando && "opacity-60")}>
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-white">
              {[r.quem, "Tipo", r.realizado, r.vencido, r.aVencer, "Total"].map((h, i) => (
                <th key={h} style={{ backgroundColor: "#0000C2" }}
                  className={cn("sticky top-0 z-10 whitespace-nowrap px-3 py-2 font-semibold", i >= 2 ? "text-right" : "text-left", i === 5 && "border-l-2 border-white/40")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!carregando && pessoas.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-[var(--text-muted)]">Nenhum {r.quem.toLowerCase()} com movimento nesse filtro.</td></tr>
            ) : pessoas.map((p, i) => {
              const total = p.realizado + p.vencido + p.a_vencer;
              const expandido = aberto === p.cd_pessoa;
              return (
                <Fragment key={`${p.cd_pessoa}|${p.grupo}`}>
                  <tr onClick={() => alternar(p.cd_pessoa)}
                    className={cn("cursor-pointer border-t border-[var(--border)] hover:bg-[#EDEDFA] dark:hover:bg-[#191934]",
                      i % 2 === 1 && "bg-[#F1F2F6] dark:bg-neutral-800", expandido && "font-semibold")}>
                    <td className="max-w-[26rem] px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {expandido ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
                        <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{p.cd_pessoa}</span>
                        <span className="truncate font-semibold text-[var(--text)]" title={p.nome}>{p.nome}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", COR_GRUPO[p.grupo] ?? COR_GRUPO.Fornecedor)}>
                        {p.grupo}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {p.realizado ? <>{v(p.realizado)} <span className="text-[10px] text-[var(--text-muted)]">· {p.qtd_realizado}</span></> : <span className="text-[var(--text-muted)]/40">–</span>}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", p.vencido && "text-amber-700 dark:text-amber-300")}>
                      {p.vencido ? <>{v(p.vencido)} <span className="text-[10px] text-[var(--text-muted)]">· {p.qtd_vencido}</span></> : <span className="text-[var(--text-muted)]/40">–</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {p.a_vencer ? <>{v(p.a_vencer)} <span className="text-[10px] text-[var(--text-muted)]">· {p.qtd_a_vencer}</span></> : <span className="text-[var(--text-muted)]/40">–</span>}
                    </td>
                    <td className="whitespace-nowrap border-l-2 border-slate-300 px-3 py-2 text-right font-bold tabular-nums dark:border-slate-600">{v(total)}</td>
                  </tr>
                  {expandido && (
                    <tr className="border-t border-[var(--border)] bg-[var(--bg)]">
                      <td colSpan={6} className="px-8 py-3">
                        {!detalhe ? (
                          <span className="text-[var(--text-muted)]"><Loader2 size={12} className="mr-1 inline animate-spin" />carregando meses…</span>
                        ) : detalhe.length === 0 ? (
                          <span className="text-[var(--text-muted)]">Sem movimento mês a mês neste período.</span>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="text-xs">
                              <thead>
                                <tr className="text-[var(--text-muted)]">
                                  <th className="pr-4 text-left font-semibold">Situação</th>
                                  {[...new Set(detalhe.map((d) => d.mes))].sort().map((m) => (
                                    <th key={m} className="px-3 text-right font-semibold">{rotuloMes(m)}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  { id: "realizado", rotulo: `${r.realizado} (mês da baixa)` },
                                  { id: "aberto", rotulo: `Em aberto (mês do vencimento)` },
                                ].map((s) => (
                                  <tr key={s.id}>
                                    <td className="whitespace-nowrap py-1 pr-4 font-semibold text-[var(--text)]">{s.rotulo}</td>
                                    {[...new Set(detalhe.map((d) => d.mes))].sort().map((m) => {
                                      const x = detalhe.find((d) => d.mes === m && d.situacao === s.id);
                                      return (
                                        <td key={m} title={x ? `${x.qtd} título(s)` : undefined}
                                          className={cn("whitespace-nowrap px-3 py-1 text-right tabular-nums",
                                            s.id === "aberto" && x && m < hoje && "text-amber-700 dark:text-amber-300")}>
                                          {x ? v(x.valor) : <span className="text-[var(--text-muted)]/40">–</span>}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
        <span>Mostrando {pessoas.length.toLocaleString("pt-BR")} de {totais.pessoas.toLocaleString("pt-BR")}, dos maiores para os menores.</span>
        {pessoas.length < totais.pessoas && (
          <button onClick={carregarMais} disabled={carregandoMais}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-semibold text-[var(--text)] hover:bg-[var(--bg)] disabled:opacity-50">
            {carregandoMais ? "Carregando…" : `Carregar mais ${POR_PAGINA}`}
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Dados do ERP, só empresas 1000 a 1024. {r.realizado} = títulos baixados no período, pelo mês da baixa e valor do documento;
        vencido e {r.aVencer.toLowerCase()} = títulos em aberto pelo mês de vencimento. Clique numa linha para ver mês a mês.
        Ficam fora: títulos reparcelados (status A), incobráveis, adiantamentos e provisões.
      </p>
    </div>
  );
}
