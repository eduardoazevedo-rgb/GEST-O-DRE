"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Download, RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid } from "recharts";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { MESES_CURTO, formatNumero } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import Button from "@/components/ui/Button";
import type { LinhaViagem } from "@/app/api/viagens/importar/route";

const COLUNAS = ["CD_EMPRESA","DOCUMENTO","DT_EMISSAO","CD_PESSOA","NM_PESSOA","CD_ITEM","DS_ITEM","QTD","VLR_ITEM","CD_CENTROCUSTO","DS_CENTROCUSTO","CD_CONTA","DS_CONTA","OBS","OBS2","VLR_CC","PESSOA"];
const CORES = ["#0000FE", "#3B82F6", "#F59E0B", "#10B981", "#8B5CF6", "#EF4444", "#14B8A6", "#EC4899"];

// Tonalidade de azul: t=1 (maior) mais forte/vivo; t=0 (menor) navy escuro.
function tomAzul(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const navy = [12, 17, 64], vivo = [37, 99, 235];
  const c = (a: number, b: number) => Math.round(a + (b - a) * x);
  return `rgb(${c(navy[0], vivo[0])}, ${c(navy[1], vivo[1])}, ${c(navy[2], vivo[2])})`;
}
// Cor por RANKING do valor (maior = mais forte), mantendo a ordem original.
function coresPorValor(valores: number[]): string[] {
  const n = valores.length;
  if (n === 0) return [];
  const rank = new Array<number>(n);
  [...valores.keys()].sort((a, b) => valores[b] - valores[a]).forEach((idx, r) => { rank[idx] = r; });
  return valores.map((_, i) => tomAzul(n <= 1 ? 1 : 1 - rank[i] / (n - 1)));
}

function parseNumBR(v: unknown): number | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/R\$/i, "").replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function parseDataBR(v: unknown): { ano: number; mes: number; iso: string } | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mes = Number(m[2]), ano = Number(m[3]);
  if (mes < 1 || mes > 12) return null;
  return { ano, mes, iso: `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}
function tipoDoItem(ds: string): string {
  const s = ds.toUpperCase();
  if (s.includes("HOSPEDAG")) return "hospedagem";
  if (s.includes("PASSAG")) return "passagem";
  if (s.includes("QUILOMETR") || s.includes("KM")) return "quilometragem";
  return "outro";
}
const ROTULO_TIPO: Record<string, string> = { hospedagem: "Hospedagem", passagem: "Passagens", quilometragem: "Quilometragem", outro: "Outros" };
// Remove acentos/diacríticos (deixa só letras) — padroniza toda a planilha.
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const str = (v: unknown) => { const s = semAcento(String(v ?? "").trim()); return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseNumBR(v); return n == null ? null : Math.trunc(n); };

interface Viagem {
  ano: number; mes: number; tipo: string; ds_item: string | null; ds_centrocusto: string | null;
  nm_pessoa: string | null; viajante: string | null; vlr_cc: number; documento: string | null;
}

export default function ViagensPage() {
  const anoAtual = new Date().getFullYear();
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();
  const { podeImportarViagens } = useAuth();

  const [ano, setAno] = useState(anoAtual);
  const [dados, setDados] = useState<Viagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [fMes, setFMes] = useState(-1);
  const [fTipo, setFTipo] = useState("");
  const [fArea, setFArea] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternarArea = (a: string) => setAbertos((p) => { const n = new Set(p); if (n.has(a)) n.delete(a); else n.add(a); return n; });

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ arquivo: string; linhas: LinhaViagem[]; meses: string[] } | null>(null);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const tudo: Viagem[] = [];
    for (let de = 0; ; de += 1000) {
      const { data } = await supabase
        .from("custo_viagens")
        .select("ano,mes,tipo,ds_item,ds_centrocusto,nm_pessoa,viajante,vlr_cc,documento")
        .eq("ano", ano)
        .range(de, de + 999);
      const lote = (data ?? []) as Viagem[];
      tudo.push(...lote);
      if (lote.length < 1000) break;
    }
    setDados(tudo);
    setCarregando(false);
  }, [supabase, ano]);

  useEffect(() => { carregar(); }, [carregar]);

  // ---- Importação ----
  function baixarModelo() {
    const conteudo = COLUNAS.join(",") + "\n" +
      `1000,5261,23/03/2026,1052374,HOTEL EXEMPLO LTDA,102209,SERVICO - HOSPEDAGENS (VEN),2,714,9060,LOGISTICA,5039,HOSPEDAGENS (VEN),,HOSPEDAGEM FULANO 12/03 A 13/03,"R$ 765,63",Fulano de Tal\n`;
    const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo-custo-viagens.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function aoSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // Detecta encoding: UTF-8 e, se vier caractere inválido (planilha Excel BR
      // costuma ser Latin1/Windows-1252), re-decodifica em windows-1252.
      const buf = await file.arrayBuffer();
      let texto = new TextDecoder("utf-8").decode(buf);
      if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
      const wb = XLSX.read(texto, { type: "string", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const linhasRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (linhasRaw.length === 0) throw new Error("Arquivo vazio");
      const faltando = COLUNAS.filter((c) => !(c in linhasRaw[0]));
      if (faltando.length > 0) throw new Error(`Faltam colunas: ${faltando.join(", ")}`);

      const linhas: LinhaViagem[] = [];
      const mesesSet = new Set<string>();
      for (const r of linhasRaw) {
        const dt = parseDataBR(r.DT_EMISSAO);
        if (!dt) continue; // pula linhas sem data válida
        const ds = str(r.DS_ITEM) ?? "";
        linhas.push({
          ano: dt.ano, mes: dt.mes, dt_emissao: dt.iso,
          cd_empresa: int(r.CD_EMPRESA), documento: str(r.DOCUMENTO),
          cd_pessoa: int(r.CD_PESSOA), nm_pessoa: str(r.NM_PESSOA),
          cd_item: str(r.CD_ITEM), ds_item: str(r.DS_ITEM), tipo: tipoDoItem(ds),
          qtd: parseNumBR(r.QTD), vlr_item: parseNumBR(r.VLR_ITEM),
          cd_centrocusto: str(r.CD_CENTROCUSTO), ds_centrocusto: str(r.DS_CENTROCUSTO),
          cd_conta: str(r.CD_CONTA), ds_conta: str(r.DS_CONTA),
          obs: str(r.OBS), obs2: str(r.OBS2),
          vlr_cc: parseNumBR(r.VLR_CC) ?? 0, viajante: str(r.PESSOA),
        });
        mesesSet.add(`${dt.ano}-${String(dt.mes).padStart(2, "0")}`);
      }
      if (linhas.length === 0) throw new Error("Nenhuma linha com data válida");
      setPreview({ arquivo: file.name, linhas, meses: [...mesesSet].sort() });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirmarImportacao() {
    if (!preview) return;
    setImportando(true);
    try {
      const res = await fetch("/api/viagens/importar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arquivo: preview.arquivo, linhas: preview.linhas }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha na importação");
      toast(`Importado: ${json.linhas} linha(s) · meses ${json.meses.join(", ")}.`, "success");
      setPreview(null);
      carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setImportando(false);
    }
  }

  // ---- Filtros + agregações ----
  const filtrado = useMemo(() => dados.filter((d) =>
    (fMes < 0 || d.mes === fMes + 1) && (!fTipo || d.tipo === fTipo) && (!fArea || d.ds_centrocusto === fArea)
  ), [dados, fMes, fTipo, fArea]);

  const areas = useMemo(() => [...new Set(dados.map((d) => d.ds_centrocusto).filter(Boolean))].sort() as string[], [dados]);
  const tipos = useMemo(() => [...new Set(dados.map((d) => d.tipo))], [dados]);

  const total = useMemo(() => filtrado.reduce((a, d) => a + d.vlr_cc, 0), [filtrado]);
  const porTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of filtrado) m.set(d.tipo, (m.get(d.tipo) ?? 0) + d.vlr_cc);
    return [...m.entries()].map(([tipo, valor]) => ({ tipo, rotulo: ROTULO_TIPO[tipo] ?? tipo, valor })).sort((a, b) => b.valor - a.valor);
  }, [filtrado]);
  const porMes = useMemo(() => MESES_CURTO.map((m, i) => ({
    mes: m, valor: filtrado.filter((d) => d.mes === i + 1).reduce((a, d) => a + d.vlr_cc, 0),
  })), [filtrado]);
  const porArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of filtrado) { const k = d.ds_centrocusto ?? "—"; m.set(k, (m.get(k) ?? 0) + d.vlr_cc); }
    return [...m.entries()].map(([area, valor]) => ({ area, valor })).sort((a, b) => b.valor - a.valor);
  }, [filtrado]);
  const topFornecedores = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of filtrado) { const k = d.nm_pessoa ?? "—"; m.set(k, (m.get(k) ?? 0) + d.vlr_cc); }
    return [...m.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [filtrado]);
  const topViajantes = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of filtrado) { const k = d.viajante ?? "—"; m.set(k, (m.get(k) ?? 0) + d.vlr_cc); }
    return [...m.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [filtrado]);
  const areaMes = useMemo(() => {
    const zeros = () => Array(12).fill(0) as number[];
    const areasMap = new Map<string, { meses: number[]; total: number; vmap: Map<string, number[]> }>();
    for (const d of filtrado) {
      const area = d.ds_centrocusto ?? "—";
      let a = areasMap.get(area);
      if (!a) { a = { meses: zeros(), total: 0, vmap: new Map() }; areasMap.set(area, a); }
      a.meses[d.mes - 1] += d.vlr_cc; a.total += d.vlr_cc;
      const vk = d.viajante ?? "—";
      if (!a.vmap.has(vk)) a.vmap.set(vk, zeros());
      a.vmap.get(vk)![d.mes - 1] += d.vlr_cc;
    }
    return [...areasMap.entries()].map(([area, a]) => ({
      area, meses: a.meses, total: a.total,
      viajantes: [...a.vmap.entries()]
        .map(([nome, meses]) => ({ nome, meses, total: meses.reduce((x, y) => x + y, 0) }))
        .sort((x, y) => y.total - x.total),
    })).sort((a, b) => b.total - a.total);
  }, [filtrado]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Custo de Viagens</h1>
          <p className="text-xs text-[var(--text-muted)]">Hospedagens e passagens · importação manual por mês</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {[-1, ...MESES_CURTO.map((_, i) => i)].map((i) => (
              <button key={i} onClick={() => setFMes(i)}
                className={cn("rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  fMes === i ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}>
                {i < 0 ? "Ano" : MESES_CURTO[i]}
              </button>
            ))}
          </div>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]">
            <option value="">Todos os tipos</option>
            {tipos.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t] ?? t}</option>)}
          </select>
          <select value={fArea} onChange={(e) => setFArea(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] max-w-44">
            <option value="">Todas as áreas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
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

      {/* Importação */}
      {podeImportarViagens && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv" onChange={aoSelecionarArquivo} className="hidden" />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={16} /> Selecionar CSV</Button>
            <Button variant="ghost" onClick={baixarModelo}><Download size={16} /> Baixar modelo</Button>
            <span className="text-xs text-[var(--text-muted)]">A importação substitui os meses presentes no arquivo (mês fechado).</span>
          </div>
          {preview && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
              <p className="text-amber-800 dark:text-amber-300">
                <b>{preview.arquivo}</b>: {preview.linhas.length} linha(s), meses {preview.meses.join(", ")}.
                Esses meses serão <b>substituídos</b>.
              </p>
              <div className="mt-2 flex gap-2">
                <Button onClick={confirmarImportacao} loading={importando}>Confirmar importação</Button>
                <Button variant="secondary" onClick={() => setPreview(null)} disabled={importando}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {carregando ? (
        <p className="py-16 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
      ) : dados.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Nenhum dado de viagem para {ano}. {podeImportarViagens ? "Importe um CSV acima." : "Peça a um administrador para importar."}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Total gasto" valor={formatNumero(total)} />
            <Kpi titulo="Lançamentos" valor={filtrado.length.toLocaleString("pt-BR")} />
            {porTipo.slice(0, 2).map((t) => (
              <Kpi key={t.tipo} titulo={t.rotulo} valor={formatNumero(t.valor)}
                sub={total ? `${((t.valor / total) * 100).toFixed(1)}%` : ""} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Mês a mês */}
            <div className="lg:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Análise mês a mês</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porMes} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumero(v)} width={70} />
                    <Tooltip formatter={(v) => formatNumero(Number(v))} />
                    <Bar dataKey="valor" radius={[3, 3, 0, 0]}>
                      {coresPorValor(porMes.map((m) => m.valor)).map((c, i) => <Cell key={i} fill={c} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Por tipo */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Por tipo</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={porTipo} dataKey="valor" nameKey="rotulo" innerRadius={45} outerRadius={80} paddingAngle={2}>
                      {porTipo.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatNumero(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 space-y-1">
                {porTipo.map((t, i) => (
                  <div key={t.tipo} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CORES[i % CORES.length] }} />
                      {t.rotulo}
                    </span>
                    <span className="tabular-nums text-[var(--text)]">{formatNumero(t.valor)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Área × mês */}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-[#0000C2] text-white">
                  <th className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-48">Área (centro de custo)</th>
                  {MESES_CURTO.map((m) => <th key={m} className="border-l border-white/20 px-2 py-1.5 text-right font-semibold">{m}</th>)}
                  <th className="border-l border-white/20 px-2 py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {areaMes.map((r) => {
                  const aberto = abertos.has(r.area);
                  return (
                    <Fragment key={r.area}>
                      <tr className="border-t border-[var(--border)] hover:bg-[var(--bg)] cursor-pointer font-medium" onClick={() => alternarArea(r.area)}>
                        <td className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-1.5">
                          <span className="inline-flex items-center gap-1">
                            {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {r.area}
                          </span>
                        </td>
                        {r.meses.map((v, i) => (
                          <td key={i} className="px-2 py-1.5 text-right tabular-nums">{v !== 0 ? formatNumero(v) : <span className="text-[var(--text-muted)]/40">–</span>}</td>
                        ))}
                        <td className="border-l border-[var(--border)] px-2 py-1.5 text-right tabular-nums font-bold">{formatNumero(r.total)}</td>
                      </tr>
                      {aberto && r.viajantes.map((v) => (
                        <tr key={v.nome} className="border-t border-[var(--border)] hover:bg-[var(--bg)] text-[var(--text-muted)]">
                          <td className="sticky left-0 z-10 bg-[var(--surface)] py-1.5 pr-3" style={{ paddingLeft: "34px" }}>{v.nome}</td>
                          {v.meses.map((val, i) => (
                            <td key={i} className="px-2 py-1.5 text-right tabular-nums">{val !== 0 ? formatNumero(val) : <span className="text-[var(--text-muted)]/30">–</span>}</td>
                          ))}
                          <td className="border-l border-[var(--border)] px-2 py-1.5 text-right tabular-nums font-semibold text-[var(--text)]">{formatNumero(v.total)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Tops */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TopTabela titulo="Top fornecedores (hotéis / agências)" itens={topFornecedores} total={total} />
            <TopTabela titulo="Top viajantes" itens={topViajantes} total={total} />
          </div>

          {/* Por área (barras) */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Valor total por área</h2>
            <div style={{ height: Math.max(180, porArea.length * 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porArea} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumero(v)} />
                  <YAxis type="category" dataKey="area" tick={{ fontSize: 11 }} width={130} />
                  <Tooltip formatter={(v) => formatNumero(Number(v))} />
                  <Bar dataKey="valor" radius={[0, 3, 3, 0]}>
                    {porArea.map((_, i) => <Cell key={i} fill={tomAzul(porArea.length <= 1 ? 1 : 1 - i / (porArea.length - 1))} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text)]">{valor}</p>
      {sub && <p className="text-xs text-[var(--text-muted)]">{sub} do total</p>}
    </div>
  );
}

function TopTabela({ titulo, itens, total }: { titulo: string; itens: { nome: string; valor: number }[]; total: number }) {
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]"><h2 className="text-sm font-semibold text-[var(--text)]">{titulo}</h2></div>
      <div className="divide-y divide-[var(--border)]">
        {itens.map((it, idx) => (
          <div key={it.nome} className="px-4 py-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-[var(--text)]" title={it.nome}>{it.nome}</span>
              <span className="tabular-nums text-[var(--text-muted)] shrink-0">
                {formatNumero(it.valor)} {total ? `· ${((it.valor / total) * 100).toFixed(1)}%` : ""}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(it.valor / max) * 100}%`, backgroundColor: tomAzul(itens.length <= 1 ? 1 : 1 - idx / (itens.length - 1)) }} />
            </div>
          </div>
        ))}
        {itens.length === 0 && <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">Sem dados.</div>}
      </div>
    </div>
  );
}
