"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useEmpresa } from "@/context/EmpresaContext";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import type { Bloco, Lancamento, Parcela, Premissa, SaldoReal } from "@/lib/fluxo-caixa";
import VisaoFluxo from "@/components/fluxo-caixa/VisaoFluxo";
import ListaLancamentos from "@/components/fluxo-caixa/ListaLancamentos";
import FormLancamento from "@/components/fluxo-caixa/FormLancamento";
import PremissasSaldo from "@/components/fluxo-caixa/PremissasSaldo";
import CruzamentoErp from "@/components/fluxo-caixa/CruzamentoErp";
import RealizadoErp from "@/components/fluxo-caixa/RealizadoErp";

type Aba = "visao" | "cruzamento" | "realizado" | "lancamentos" | "premissas";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "visao", rotulo: "Fluxo próprio" },
  { id: "cruzamento", rotulo: "Previsto × Sistema" },
  { id: "realizado", rotulo: "Fluxo sistema" },
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "premissas", rotulo: "Premissas e saldo real" },
];

type LinhaBanco = Omit<Lancamento, "parcelas"> & { parcelas: Parcela[] | null };

// PostgREST devolve numeric às vezes como texto: normaliza tudo para número.
function normalizar(l: LinhaBanco): Lancamento {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...l,
    unidade: n(l.unidade),
    ano_projeto: n(l.ano_projeto),
    valor_total: n(l.valor_total),
    n_parcelas: n(l.n_parcelas),
    intervalo_meses: Number(l.intervalo_meses ?? 1),
    entrada_pct: n(l.entrada_pct),
    parcelas: (l.parcelas ?? [])
      .map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor), ajustada: !!p.ajustada }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
  };
}

export default function FluxoCaixaPage() {
  const supabase = useMemo(() => createClient(), []);
  const { empresaId, empresa } = useEmpresa();
  const { editaPremissasFc } = useAuth();

  const [aba, setAba] = useState<Aba>("visao");
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [premissas, setPremissas] = useState<Premissa[]>([]);
  const [saldos, setSaldos] = useState<SaldoReal[]>([]);
  const [filiais, setFiliais] = useState<{ cd: number; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<Lancamento | "novo" | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      // Lançamentos já com as parcelas; paginado (limite de 1000 linhas por resposta).
      const lancs: Lancamento[] = [];
      for (let de = 0; ; de += 500) {
        const { data, error } = await supabase
          .from("fc_lancamentos")
          .select("*, parcelas:fc_parcelas(vencimento, valor, ajustada)")
          .eq("empresa_id", empresaId)
          .order("descricao")
          .range(de, de + 499);
        if (error) throw new Error(error.message);
        const lote = (data ?? []) as LinhaBanco[];
        lancs.push(...lote.map(normalizar));
        if (lote.length < 500) break;
      }
      const [b, p, s, f] = await Promise.all([
        supabase.from("fc_blocos").select("id, nome, ordem").order("ordem"),
        supabase.from("fc_premissas").select("mes, tipo, valor").eq("empresa_id", empresaId).order("mes").range(0, 9999),
        supabase.from("fc_saldos_reais").select("mes, valor").eq("empresa_id", empresaId).order("mes").range(0, 9999),
        supabase.from("filiais").select("cd_empresa, nome").eq("empresa_id", empresaId).order("cd_empresa"),
      ]);
      for (const r of [b, p, s, f]) if (r.error) throw new Error(r.error.message);
      setLancamentos(lancs);
      setBlocos((b.data ?? []) as Bloco[]);
      setPremissas((p.data ?? []).map((x: { mes: string; tipo: Premissa["tipo"]; valor: number | string }) => ({ ...x, valor: Number(x.valor) })));
      setSaldos((s.data ?? []).map((x: { mes: string; valor: number | string }) => ({ ...x, valor: Number(x.valor) })));
      setFiliais((f.data ?? []).map((x: { cd_empresa: number; nome: string }) => ({ cd: x.cd_empresa, nome: x.nome })));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [supabase, empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrir = useCallback((l: Lancamento) => setEditando(l), []);

  // Linha criada direto na grade do Fluxo próprio: vira um lançamento manual, com uma
  // parcela por mês preenchido.
  const criarLinha = useCallback(async (dados: { bloco_id: string; descricao: string; parcelas: { vencimento: string; valor: number }[] }) => {
    const soma = dados.parcelas.reduce((s, p) => s + p.valor, 0);
    const { error } = await supabase.rpc("fc_salvar_lancamento", {
      p_lancamento: {
        empresa_id: empresaId, bloco_id: dados.bloco_id, descricao: dados.descricao,
        status: "previsto", tipo: soma >= 0 ? "entrada" : "saida", regra: "manual",
        valor_total: Math.abs(Math.round(soma * 100) / 100),
        primeiro_vencimento: dados.parcelas[0].vencimento,
        n_parcelas: dados.parcelas.length, intervalo_meses: 1, origem: "Fluxo próprio",
      },
      p_parcelas: dados.parcelas.map((p) => ({ ...p, ajustada: true })),
    });
    if (error) throw new Error(error.message);
    await carregar();
  }, [supabase, empresaId, carregar]);

  return (
    // A aba inteira em caixa alta (texto digitado é gravado como foi escrito).
    <div className="space-y-4 uppercase">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Fluxo de Caixa</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {empresa?.nome ?? "—"} · {lancamentos.filter((l) => l.status !== "cancelado").length} lançamentos ativos
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setEditando("novo")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus size={14} /> Novo lançamento
          </button>
          <button onClick={carregar} title="Recarregar"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-muted)] hover:text-[var(--text)]">
            <RefreshCw size={16} className={cn(carregando && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors",
              aba === a.id
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {erro && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      {carregando && lancamentos.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
      ) : aba === "visao" ? (
        <VisaoFluxo blocos={blocos} lancamentos={lancamentos} premissas={premissas} saldos={saldos} onAbrir={abrir} onCriar={criarLinha} />
      ) : aba === "cruzamento" ? (
        <CruzamentoErp empresaId={empresaId} lancamentos={lancamentos} premissas={premissas} />
      ) : aba === "realizado" ? (
        <RealizadoErp empresaId={empresaId} />
      ) : aba === "lancamentos" ? (
        <ListaLancamentos blocos={blocos} lancamentos={lancamentos} filiais={filiais} onAbrir={abrir} />
      ) : (
        <PremissasSaldo
          empresaId={empresaId}
          premissas={premissas}
          saldos={saldos}
          lancamentos={lancamentos}
          podeEditar={editaPremissasFc}
          onSalvo={carregar}
        />
      )}

      {editando && (
        <FormLancamento
          empresaId={empresaId}
          lancamento={editando === "novo" ? null : editando}
          blocos={blocos}
          filiais={filiais}
          onClose={() => setEditando(null)}
          onSalvo={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}
