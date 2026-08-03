"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, ChevronRight, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useEmpresa } from "@/context/EmpresaContext";
import { useToast } from "@/context/ToastContext";
import Button from "@/components/ui/Button";
import type { Filial, PlanoConta } from "@/lib/types";
import type { UsuarioLinha } from "./UsuariosTabela";


interface Props {
  usuario: UsuarioLinha;
  onClose: () => void;
}

interface No {
  codigo: string;
  nome: string;
  nivel: number;
  filhos: No[];
}

function comparaCodigos(a: string, b: string): number {
  const sa = a.split(".").map(Number);
  const sb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const da = sa[i] ?? -1;
    const db = sb[i] ?? -1;
    if (da !== db) return da - db;
  }
  return 0;
}

function pai(codigo: string): string | null {
  const i = codigo.lastIndexOf(".");
  return i > 0 ? codigo.slice(0, i) : null;
}

/** Monta a árvore a partir dos códigos (a hierarquia é dada pelos segmentos). */
function montarArvore(plano: PlanoConta[]): No[] {
  const nos = new Map<string, No>();
  const raizes: No[] = [];
  for (const p of [...plano].sort((a, b) => comparaCodigos(a.codigo, b.codigo))) {
    const no: No = { codigo: p.codigo, nome: p.nome, nivel: p.nivel, filhos: [] };
    nos.set(p.codigo, no);
    const codigoPai = pai(p.codigo);
    const noPai = codigoPai ? nos.get(codigoPai) : undefined;
    if (noPai) noPai.filhos.push(no);
    else raizes.push(no);
  }
  return raizes;
}

export default function VinculosModal({ usuario, onClose }: Props) {
  const { empresaId: EMPRESA_ID, empresa: empresaAtual } = useEmpresa();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [plano, setPlano] = useState<PlanoConta[]>([]);
  const [filiaisSel, setFiliaisSel] = useState<Set<number>>(new Set());
  const [contasSel, setContasSel] = useState<Set<string>>(new Set());
  // Contas vinculadas nas OUTRAS empresas: o modal edita só a empresa atual,
  // mas o PUT substitui a lista inteira — então elas voltam junto no salvar.
  const [contasOutras, setContasOutras] = useState<{ empresa_id: number; codigo: string }[]>([]);
  const [restringeEmpresas, setRestringeEmpresas] = useState(true);
  const [restringeContas, setRestringeContas] = useState(true);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const planoTudo: PlanoConta[] = [];
        for (let de = 0; ; de += 1000) {
          const { data } = await supabase
            .from("plano_contas").select("*").eq("empresa_id", EMPRESA_ID)
            .order("codigo").range(de, de + 999);
          planoTudo.push(...((data ?? []) as PlanoConta[]));
          if ((data ?? []).length < 1000) break;
        }
        const { data: fils } = await supabase.from("filiais").select("*").order("cd_empresa");

        const res = await fetch(`/api/usuarios/${usuario.id}/vinculos`);
        const vinc = await res.json();
        if (!res.ok) throw new Error(vinc.error ?? "Erro ao carregar vínculos");

        setPlano(planoTudo);
        setFiliais((fils ?? []) as Filial[]);
        setFiliaisSel(new Set<number>(vinc.filiais ?? []));
        const todasContas = (vinc.contas ?? []) as { empresa_id: number; codigo: string }[];
        setContasSel(new Set(todasContas.filter((c) => c.empresa_id === EMPRESA_ID).map((c) => c.codigo)));
        setContasOutras(todasContas.filter((c) => c.empresa_id !== EMPRESA_ID));
        setRestringeEmpresas(vinc.restringe_empresas !== false);
        setRestringeContas(vinc.restringe_contas !== false);
        // abre os grupos N2 por padrão
        setAbertos(new Set(planoTudo.filter(p => p.nivel === 2).map(p => p.codigo)));
      } catch (e) {
        toast(e instanceof Error ? e.message : "Erro ao carregar dados", "error");
        onClose();
      } finally {
        setCarregando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.id, EMPRESA_ID]);

  const arvore = useMemo(() => montarArvore(plano), [plano]);

  /** Coberto por um vínculo próprio ou de um ancestral. */
  function cobertoPor(codigo: string): string | null {
    if (contasSel.has(codigo)) return codigo;
    for (const s of contasSel) if (codigo.startsWith(s + ".")) return s;
    return null;
  }

  function alternarConta(codigo: string) {
    setContasSel(prev => {
      const novo = new Set(prev);
      if (novo.has(codigo)) {
        novo.delete(codigo);
      } else {
        // remove vínculos redundantes de descendentes e marca o nó
        for (const s of [...novo]) if (s.startsWith(codigo + ".")) novo.delete(s);
        novo.add(codigo);
      }
      return novo;
    });
  }

  function alternarAberto(codigo: string) {
    setAbertos(prev => {
      const novo = new Set(prev);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  }

  async function salvar() {
    setSalvando(true);
    try {
      const res = await fetch(`/api/usuarios/${usuario.id}/vinculos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restringe_empresas: restringeEmpresas,
          restringe_contas: restringeContas,
          filiais: [...filiaisSel],
          contas: [...contasOutras, ...[...contasSel].map(codigo => ({ empresa_id: EMPRESA_ID, codigo }))],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Erro ao salvar vínculos", "error");
      } else {
        toast(`Vínculos de ${usuario.nome} salvos.`);
        router.refresh();
        onClose();
      }
    } catch {
      toast("Erro de conexão com o servidor", "error");
    } finally {
      setSalvando(false);
    }
  }

  function renderNo(no: No): React.ReactNode {
    const cobertura = cobertoPor(no.codigo);
    const herdado = cobertura !== null && cobertura !== no.codigo;
    const aberto = abertos.has(no.codigo);
    return (
      <div key={no.codigo}>
        <div
          className="flex items-center gap-1.5 py-1 rounded hover:bg-[var(--bg)]"
          style={{ paddingLeft: `${(no.nivel - 2) * 18}px` }}
        >
          {no.filhos.length > 0 ? (
            <button type="button" onClick={() => alternarAberto(no.codigo)} className="text-[var(--text-muted)] shrink-0">
              {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <label className={`flex items-center gap-2 text-xs cursor-pointer min-w-0 ${herdado ? "opacity-60" : ""}`}>
            <input
              type="checkbox"
              checked={cobertura !== null}
              disabled={herdado}
              onChange={() => alternarConta(no.codigo)}
              className="rounded border-gray-400 shrink-0"
            />
            <span className={`truncate ${no.nivel === 2 ? "font-semibold" : ""} text-[var(--text)]`}>
              {no.codigo}. {no.nome}
            </span>
          </label>
        </div>
        {aberto && no.filhos.map(renderNo)}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl w-full max-w-2xl p-6 flex flex-col gap-4 max-h-[90vh]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--text)]">Vínculos de acesso</h3>
            <p className="text-sm text-[var(--text-muted)]">{usuario.nome} · {usuario.email}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={18} /></button>
        </div>

        {carregando ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <Building2 size={12} className="inline mr-1 -mt-0.5" />
                  Unidades ({filiaisSel.size ? `${filiaisSel.size} de ${filiais.length}` : filiais.length})
                </p>
                <div className="flex items-center gap-3">
                  {restringeEmpresas && (
                    <>
                      <button type="button" onClick={() => setFiliaisSel(new Set(filiais.map(f => f.cd_empresa)))}
                        className="text-xs text-blue-600 hover:underline">Marcar todas</button>
                      <button type="button" onClick={() => setFiliaisSel(new Set())}
                        className="text-xs text-blue-600 hover:underline">Limpar</button>
                    </>
                  )}
                  <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restringeEmpresas}
                      onChange={e => setRestringeEmpresas(e.target.checked)}
                      className="rounded border-gray-400"
                    />
                    Restringir por unidade
                  </label>
                </div>
              </div>
              {restringeEmpresas ? (
                <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border)] p-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                  {filiais.map(f => (
                    <label key={f.cd_empresa} className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={filiaisSel.has(f.cd_empresa)}
                        onChange={() =>
                          setFiliaisSel(prev => {
                            const novo = new Set(prev);
                            if (novo.has(f.cd_empresa)) novo.delete(f.cd_empresa);
                            else novo.add(f.cd_empresa);
                            return novo;
                          })
                        }
                        className="rounded border-gray-400 shrink-0"
                      />
                      <span className="font-mono text-[var(--text-muted)] shrink-0">{f.cd_empresa}</span>
                      <span className="truncate">{f.nome}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-[var(--text-muted)]">
                  Sem restrição: este usuário enxerga <strong>todas as unidades</strong>.
                </p>
              )}
            </div>

            <div className="flex-1 min-h-0 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Contas gerenciais</p>
                <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restringeContas}
                    onChange={e => setRestringeContas(e.target.checked)}
                    className="rounded border-gray-400"
                  />
                  Restringir por conta
                </label>
              </div>
              {restringeContas ? (
                <>
                  <p className="text-xs text-[var(--text-muted)] text-right">
                    Marcar um grupo dá acesso a toda a subárvore dele · {contasSel.size} vínculo{contasSel.size !== 1 ? "s" : ""}
                    {empresaAtual && <> na {empresaAtual.codigo}</>}
                    {contasOutras.length > 0 && <> · {contasOutras.length} em outras empresas (preservados)</>}
                  </p>
                  <div className="flex-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                    {arvore.map(renderNo)}
                  </div>
                </>
              ) : (
                <p className="text-xs rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-[var(--text-muted)]">
                  Sem restrição: este usuário enxerga <strong>todas as contas</strong> (das unidades às quais tem acesso).
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
              <Button onClick={salvar} loading={salvando}>Salvar vínculos</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
