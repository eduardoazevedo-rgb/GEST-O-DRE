"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Clock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import Button from "@/components/ui/Button";

interface SyncEstado {
  ultimo_nr_lancamento: number | null;
  ultima_competencia: string | null;
  atualizado_em: string | null;
  em_execucao_desde: string | null;
}
interface SyncPedido {
  id: number;
  tipo: string;
  origem: string;
  status: string;
  criado_em: string;
  finalizado_em: string | null;
  linhas: number | null;
  mensagem: string | null;
}

const fmtData = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR") : "–");
const fmtComp = (s: string | null) => {
  if (!s) return "–";
  const d = new Date(s);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};

export default function SincronizacaoPage() {
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();
  const { user, isAdmin, podeSincronizar } = useAuth();

  const [estado, setEstado] = useState<SyncEstado | null>(null);
  const [pedidos, setPedidos] = useState<SyncPedido[]>([]);
  const [enviando, setEnviando] = useState(false);
  const anoAtual = new Date().getFullYear();

  const carregar = useCallback(async () => {
    const [{ data: est }, { data: peds }] = await Promise.all([
      supabase.from("sync_estado").select("*").eq("id", 1).single(),
      supabase.from("sync_pedidos").select("*").order("id", { ascending: false }).limit(20),
    ]);
    setEstado((est ?? null) as SyncEstado | null);
    setPedidos((peds ?? []) as SyncPedido[]);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  // Enquanto houver pedido pendente/executando (ou lock ativo), atualiza a cada 4s.
  const ativo = estado?.em_execucao_desde != null || pedidos.some((p) => p.status === "pendente" || p.status === "executando");
  const ativoRef = useRef(ativo);
  ativoRef.current = ativo;
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => { if (ativoRef.current) carregar(); }, 4000);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  async function enfileirar(tipo: string, params: Record<string, unknown> | null = null) {
    if (!user) return;
    setEnviando(true);
    try {
      const { error } = await supabase.from("sync_pedidos").insert({ tipo, params, origem: "botao", solicitado_por: user.id });
      if (error) throw new Error(error.message);
      toast("Pedido enviado — a atualização começa em instantes.", "success");
      await carregar();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-[var(--text)]">Sincronização com o ERP</h1>

      {/* Status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Clock size={13} /> Última atualização</p>
          <p className="mt-1 text-lg font-bold text-[var(--text)]">{fmtData(estado?.atualizado_em ?? null)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-xs text-[var(--text-muted)]">Dados até a competência</p>
          <p className="mt-1 text-lg font-bold text-[var(--text)] capitalize">{fmtComp(estado?.ultima_competencia ?? null)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-xs text-[var(--text-muted)]">Estado</p>
          <p className="mt-1 text-lg font-bold flex items-center gap-1.5">
            {estado?.em_execucao_desde
              ? <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5"><Loader2 size={16} className="animate-spin" /> Atualizando…</span>
              : <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={16} /> Em dia</span>}
          </p>
        </div>
      </div>

      {/* Ação */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <p className="text-sm text-[var(--text)]">
          A atualização automática roda <b>2×/dia (06:00 e 14:00)</b> na máquina da empresa. Use o botão para
          atualizar na hora — ele busca só o que entrou desde a última vez (rápido).
        </p>
        {podeSincronizar ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => enfileirar("incremental")} loading={enviando || !!estado?.em_execucao_desde}>
              <RefreshCw size={16} /> Atualizar agora
            </Button>
            {isAdmin && (
              <>
                <Button variant="secondary" onClick={() => enfileirar("full_ano", { ano: anoAtual })} loading={enviando}>
                  Recarregar {anoAtual} (completo)
                </Button>
                <Button variant="secondary" onClick={() => enfileirar("full_hist")} loading={enviando}>
                  Recarregar histórico
                </Button>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Você não tem permissão para disparar atualizações. Peça a um administrador.</p>
        )}
      </div>

      {/* Histórico de pedidos */}
      {podeSincronizar && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-[#0000C2] text-white">
                <th className="px-3 py-2 text-left font-semibold">Criado</th>
                <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                <th className="px-3 py-2 text-center font-semibold">Origem</th>
                <th className="px-3 py-2 text-center font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Linhas</th>
                <th className="px-3 py-2 text-left font-semibold">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--text-muted)]">Nenhum pedido ainda.</td></tr>
              )}
              {pedidos.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-1.5 whitespace-nowrap">{fmtData(p.criado_em)}</td>
                  <td className="px-3 py-1.5">{p.tipo}</td>
                  <td className="px-3 py-1.5 text-center">{p.origem}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={
                      p.status === "ok" ? "text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-1"
                        : p.status === "erro" ? "text-red-600 dark:text-red-400 font-medium inline-flex items-center gap-1"
                          : "text-amber-600 dark:text-amber-400 font-medium inline-flex items-center gap-1"
                    }>
                      {p.status === "ok" ? <CheckCircle2 size={12} /> : p.status === "erro" ? <AlertCircle size={12} /> : <Loader2 size={12} className="animate-spin" />}
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.linhas ?? "–"}</td>
                  <td className="px-3 py-1.5 max-w-96 truncate" title={p.mensagem ?? ""}>{p.mensagem ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
