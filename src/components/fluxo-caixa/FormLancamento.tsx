"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  REGRAS, STATUS, formatReais, gerarParcelas, lerValor, rotuloData, somarMeses,
  type Bloco, type Lancamento, type Parcela, type Regra, type Status, type Tipo,
} from "@/lib/fluxo-caixa";

interface Props {
  empresaId: number;
  lancamento: Lancamento | null; // null = novo
  blocos: Bloco[];
  filiais: { cd: number; nome: string }[];
  onClose: () => void;
  onSalvo: () => void;
}

const proximoDia1 = () => {
  const h = new Date();
  return somarMeses(`${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`, 1);
};

const campo = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40";
const rotulo = "text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]";

export default function FormLancamento({ empresaId, lancamento: l, blocos, filiais, onClose, onSalvo }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();

  const [descricao, setDescricao] = useState(l?.descricao ?? "");
  const [blocoId, setBlocoId] = useState(l?.bloco_id ?? "investimentos");
  const [unidade, setUnidade] = useState(l?.unidade != null ? String(l.unidade) : "");
  const [anoProjeto, setAnoProjeto] = useState(l?.ano_projeto != null ? String(l.ano_projeto) : "");
  const [responsavel, setResponsavel] = useState(l?.responsavel ?? "");
  const [status, setStatus] = useState<Status>(l?.status ?? "previsto");
  const [tipo, setTipo] = useState<Tipo>(l?.tipo ?? "saida");
  const [regra, setRegra] = useState<Regra>(l?.regra ?? "parcelado");
  const [valorTotal, setValorTotal] = useState(l?.valor_total != null ? formatReais(l.valor_total, 2) : "");
  const [primeiroVenc, setPrimeiroVenc] = useState(l?.primeiro_vencimento ?? proximoDia1());
  const [nParcelas, setNParcelas] = useState(String(l?.n_parcelas ?? 1));
  const [intervalo, setIntervalo] = useState(String(l?.intervalo_meses ?? 1));
  const [entradaPct, setEntradaPct] = useState(l?.entrada_pct != null ? String(l.entrada_pct) : "30");
  const [codigosErp, setCodigosErp] = useState(l?.codigos_erp ?? "");
  const [observacao, setObservacao] = useState(l?.observacao ?? "");
  // Modo manual: cada parcela com o próprio sinal (negativo = saída).
  const [manuais, setManuais] = useState<{ vencimento: string; valor: string }[]>(
    l?.regra === "manual" ? l.parcelas.map((p) => ({ vencimento: p.vencimento, valor: formatReais(p.valor, 2) })) : []
  );
  const [salvando, setSalvando] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const previa: Parcela[] = useMemo(() => {
    if (regra === "manual") return [];
    return gerarParcelas({
      regra, tipo,
      valorTotal: lerValor(valorTotal) ?? 0,
      primeiroVencimento: primeiroVenc,
      nParcelas: Number(nParcelas) || 1,
      intervaloMeses: Number(intervalo) || 1,
      entradaPct: Number(entradaPct) || 0,
    });
  }, [regra, tipo, valorTotal, primeiroVenc, nParcelas, intervalo, entradaPct]);

  const parcelasManuais: Parcela[] = manuais
    .map((m) => ({ vencimento: m.vencimento, valor: lerValor(m.valor) ?? 0 }))
    .filter((p) => p.vencimento && p.valor !== 0);
  const parcelas = regra === "manual" ? parcelasManuais : previa;
  const soma = parcelas.reduce((s, p) => s + p.valor, 0);

  function trocarRegra(nova: Regra) {
    // Ao ir para o manual, parte das parcelas que a regra atual já gerava.
    if (nova === "manual" && manuais.length === 0) {
      const base = previa.length ? previa : (l?.parcelas ?? []);
      setManuais(base.map((p) => ({ vencimento: p.vencimento, valor: formatReais(p.valor, 2) })));
    }
    setRegra(nova);
  }

  async function salvar() {
    if (!descricao.trim()) { toast("Informe a descrição.", "error"); return; }
    if (regra !== "manual") {
      if (!((lerValor(valorTotal) ?? 0) > 0)) { toast("Informe o valor total (maior que zero).", "error"); return; }
      if (!primeiroVenc) { toast("Informe o 1º vencimento.", "error"); return; }
    }
    if (parcelas.length === 0 && status !== "cancelado") {
      toast("O lançamento precisa de ao menos uma parcela com valor.", "error"); return;
    }

    const tipoFinal: Tipo = regra === "manual" ? (soma > 0 ? "entrada" : soma < 0 ? "saida" : tipo) : tipo;
    const payload = {
      id: l?.id ?? null,
      empresa_id: empresaId,
      bloco_id: blocoId,
      unidade: unidade || null,
      descricao: descricao.trim(),
      ano_projeto: anoProjeto || null,
      responsavel: responsavel.trim() || null,
      status,
      tipo: tipoFinal,
      regra,
      valor_total: regra === "manual" ? Math.abs(Math.round(soma * 100) / 100) : lerValor(valorTotal),
      primeiro_vencimento: regra === "manual" ? (parcelas[0]?.vencimento ?? null) : primeiroVenc,
      n_parcelas: regra === "manual" ? parcelas.length || null : Number(nParcelas) || 1,
      intervalo_meses: Number(intervalo) || 1,
      entrada_pct: regra === "entrada_parcelas" ? Number(entradaPct) || 0 : null,
      codigos_erp: codigosErp.trim() || null,
      observacao: observacao.trim() || null,
    };

    setSalvando(true);
    const { error } = await supabase.rpc("fc_salvar_lancamento", {
      p_lancamento: payload,
      p_parcelas: parcelas.map((p) => ({ ...p, ajustada: regra === "manual" })),
    });
    setSalvando(false);
    if (error) { toast(error.message, "error"); return; }
    toast(l ? "Lançamento atualizado." : "Lançamento criado.");
    onSalvo();
  }

  async function excluir() {
    if (!l) return;
    setSalvando(true);
    const { error } = await supabase.from("fc_lancamentos").delete().eq("id", l.id);
    setSalvando(false);
    setConfirmarExclusao(false);
    if (error) { toast(error.message, "error"); return; }
    toast("Lançamento excluído.");
    onSalvo();
  }

  const unidades = filiais.some((f) => String(f.cd) === unidade) || !unidade
    ? filiais
    : [...filiais, { cd: Number(unidade), nome: "" }];

  // O diálogo de exclusão fica FORA do fundo escuro: dentro dele, o clique no
  // "Excluir" subiria até o fundo e fecharia o formulário antes de excluir.
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl bg-[var(--surface)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--text)]">{l ? "Editar lançamento" : "Novo lançamento"}</h3>
            {l?.origem && <p className="truncate text-xs text-[var(--text-muted)]">{l.origem}</p>}
          </div>
          <button onClick={onClose} title="Fechar" className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={18} /></button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <label className={rotulo} htmlFor="fl-desc">Descrição</label>
            <input id="fl-desc" className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <label className={rotulo} htmlFor="fl-bloco">Bloco</label>
            <select id="fl-bloco" className={campo} value={blocoId} onChange={(e) => setBlocoId(e.target.value)}>
              {blocos.map((b) => <option key={b.id} value={b.id}>{b.pai_id ? `  · ${b.nome}` : b.nome}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={rotulo} htmlFor="fl-unid">Unidade</label>
            <select id="fl-unid" className={campo} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
              <option value="">— Corporativo</option>
              {unidades.map((f) => <option key={f.cd} value={f.cd}>{f.cd}{f.nome ? ` · ${f.nome}` : ""}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={rotulo} htmlFor="fl-status">Status</label>
            <select id="fl-status" className={campo} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUS.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label className={rotulo} htmlFor="fl-resp">Responsável</label>
            <input id="fl-resp" className={campo} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <label className={rotulo} htmlFor="fl-ano">Ano do projeto</label>
            <input id="fl-ano" className={campo} inputMode="numeric" value={anoProjeto} onChange={(e) => setAnoProjeto(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </div>

          <div className="sm:col-span-6">
            <span className={rotulo}>Como distribuir</span>
            <div className="mt-1 flex flex-wrap gap-1 rounded-lg border border-[var(--border)] p-0.5">
              {REGRAS.map((r) => (
                <button key={r.id} type="button" onClick={() => trocarRegra(r.id)}
                  className={cn("rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    regra === r.id ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}>
                  {r.rotulo}
                </button>
              ))}
            </div>
          </div>

          {regra !== "manual" ? (
            <>
              <div className="sm:col-span-2">
                <span className={rotulo}>Tipo</span>
                <div className="mt-1 flex rounded-lg border border-[var(--border)] p-0.5">
                  {(["saida", "entrada"] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setTipo(t)}
                      className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-semibold",
                        tipo === t ? (t === "saida" ? "bg-red-600 text-white" : "bg-emerald-600 text-white") : "text-[var(--text-muted)]")}>
                      {t === "saida" ? "Saída" : "Entrada"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={rotulo} htmlFor="fl-total">Valor total (R$)</label>
                <input id="fl-total" className={cn(campo, "text-right tabular-nums")} inputMode="decimal" placeholder="0,00"
                  value={valorTotal} onChange={(e) => setValorTotal(e.target.value)}
                  onBlur={() => { const v = lerValor(valorTotal); if (v != null) setValorTotal(formatReais(Math.abs(v), 2)); }} />
              </div>
              <div className="sm:col-span-2">
                <label className={rotulo} htmlFor="fl-venc">1º vencimento</label>
                <input id="fl-venc" type="date" className={campo} value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} />
              </div>
              {regra !== "avista" && (
                <>
                  <div className="sm:col-span-2">
                    <label className={rotulo} htmlFor="fl-parc">Parcelas</label>
                    <input id="fl-parc" className={campo} inputMode="numeric" value={nParcelas}
                      onChange={(e) => setNParcelas(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={rotulo} htmlFor="fl-int">Intervalo</label>
                    <select id="fl-int" className={campo} value={intervalo} onChange={(e) => setIntervalo(e.target.value)}>
                      <option value="1">Mensal</option>
                      <option value="2">Bimestral</option>
                      <option value="3">Trimestral</option>
                      <option value="6">Semestral</option>
                      <option value="12">Anual</option>
                    </select>
                  </div>
                  {regra === "entrada_parcelas" && (
                    <div className="sm:col-span-2">
                      <label className={rotulo} htmlFor="fl-entrada">Entrada (%)</label>
                      <input id="fl-entrada" className={campo} inputMode="decimal" value={entradaPct}
                        onChange={(e) => setEntradaPct(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))} />
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="sm:col-span-6 space-y-2">
              <p className="text-xs text-[var(--text-muted)]">Cada parcela com o próprio valor: <b>negativo é saída</b>, positivo é entrada.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left"><th className={cn(rotulo, "pb-1")}>Vencimento</th><th className={cn(rotulo, "pb-1 text-right")}>Valor (R$)</th><th /></tr>
                  </thead>
                  <tbody>
                    {manuais.map((m, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-2">
                          <input type="date" aria-label={`Vencimento da parcela ${i + 1}`} className={campo} value={m.vencimento}
                            onChange={(e) => setManuais((a) => a.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))} />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`Valor da parcela ${i + 1}`} inputMode="decimal" className={cn(campo, "text-right tabular-nums")} value={m.valor}
                            onChange={(e) => setManuais((a) => a.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                            onBlur={() => { const v = lerValor(m.valor); if (v != null) setManuais((a) => a.map((x, j) => (j === i ? { ...x, valor: formatReais(v, 2) } : x))); }} />
                        </td>
                        <td className="py-1 text-right">
                          <button type="button" title="Remover parcela" onClick={() => setManuais((a) => a.filter((_, j) => j !== i))}
                            className="rounded p-1.5 text-[var(--text-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button"
                onClick={() => setManuais((a) => [...a, { vencimento: a.length ? somarMeses(a[a.length - 1].vencimento, 1) : primeiroVenc, valor: "" }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline">
                <Plus size={13} /> Adicionar parcela
              </button>
            </div>
          )}

          <div className="sm:col-span-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={rotulo}>
                Prévia · {parcelas.length} parcela{parcelas.length !== 1 ? "s" : ""}
              </span>
              <span className={cn("text-sm font-bold tabular-nums", soma > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--text)]")}>
                Total R$ {formatReais(soma, 2)}
              </span>
            </div>
            {parcelas.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--text-muted)]">Sem parcelas — preencha valor e vencimento.</p>
            ) : (
              <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
                {parcelas.map((p, i) => (
                  <div key={i} className="rounded-lg border border-[var(--border)] px-2 py-1.5">
                    <div className="text-[11px] text-[var(--text-muted)]">{rotuloData(p.vencimento)}</div>
                    <div className={cn("text-xs font-bold tabular-nums", p.valor > 0 && "text-emerald-600 dark:text-emerald-400")}>{formatReais(p.valor, 2)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sm:col-span-6">
            <label className={rotulo} htmlFor="fl-erp">Códigos no ERP <span className="tracking-normal font-normal">(opcional — para automatizar no futuro)</span></label>
            <input id="fl-erp" className={cn(campo, "font-mono")} value={codigosErp} onChange={(e) => setCodigosErp(e.target.value)} placeholder="ex.: 1059213, 1059214" />
          </div>
          <div className="sm:col-span-6">
            <label className={rotulo} htmlFor="fl-obs">Observação</label>
            <textarea id="fl-obs" rows={3} className={campo} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-6 py-3">
          <div>
            {l && (
              <button type="button" onClick={() => setConfirmarExclusao(true)} disabled={salvando}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-900/30">
                <Trash2 size={14} /> Excluir
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={salvando}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--bg)]">Cancelar</button>
            <button type="button" onClick={salvar} disabled={salvando}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {salvando ? "Salvando…" : "Salvar lançamento"}
            </button>
          </div>
        </div>
      </div>
    </div>

      <ConfirmDialog
        open={confirmarExclusao}
        title="Excluir lançamento"
        message={`"${l?.descricao ?? ""}" e todas as parcelas serão apagados. Para só tirar do saldo e manter o registro, use o status Cancelado.`}
        confirmLabel="Excluir"
        loading={salvando}
        onConfirm={excluir}
        onCancel={() => setConfirmarExclusao(false)}
      />
    </>
  );
}
