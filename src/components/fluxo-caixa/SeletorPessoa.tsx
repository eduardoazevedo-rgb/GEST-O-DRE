"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Pessoa { cd_pessoa: number; nome: string; titulos: number }

interface Props {
  valor: number | null;
  /** Nome já conhecido (ao editar), para não precisar buscar de novo. */
  nomeInicial?: string | null;
  onChange: (cd: number | null, nome: string | null) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}

/**
 * Busca um fornecedor/cliente no cadastro do ERP (tabela fc_erp_pessoas, que a
 * sincronização mantém). Digite parte do nome ou o código.
 */
export default function SeletorPessoa({ valor, nomeInicial, onChange, className, placeholder, id }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [texto, setTexto] = useState("");
  const [nome, setNome] = useState(nomeInicial ?? "");
  const [lista, setLista] = useState<Pessoa[]>([]);
  const [aberto, setAberto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  // Nome do que já estava salvo, quando a tela não recebeu o nome pronto.
  useEffect(() => {
    if (valor == null || nome) return;
    let vivo = true;
    supabase.from("fc_erp_pessoas").select("nome").eq("cd_pessoa", valor).maybeSingle()
      .then(({ data }) => { if (vivo && data?.nome) setNome(String(data.nome)); });
    return () => { vivo = false; };
  }, [supabase, valor, nome]);

  // Busca depois de uma pausa na digitação.
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(async () => {
      setBuscando(true);
      const { data } = await supabase.rpc("fc_buscar_pessoas", { p_busca: texto.trim() || null, p_limite: 20 });
      setLista(((data ?? []) as Record<string, unknown>[]).map((x) => ({
        cd_pessoa: Number(x.cd_pessoa), nome: String(x.nome), titulos: Number(x.titulos),
      })));
      setBuscando(false);
    }, 300);
    return () => clearTimeout(t);
  }, [supabase, texto, aberto]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function escolher(p: Pessoa) {
    setNome(p.nome);
    setTexto("");
    setAberto(false);
    onChange(p.cd_pessoa, p.nome);
  }

  function limpar() {
    setNome("");
    setTexto("");
    onChange(null, null);
  }

  return (
    <div ref={caixa} className="relative">
      {valor != null ? (
        <div className={cn("flex items-center gap-1.5 truncate rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm", className)}>
          <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{valor}</span>
          <span className="truncate text-[var(--text)]" title={nome}>{nome || "—"}</span>
          <button type="button" onClick={limpar} title="Tirar o fornecedor"
            className="ml-auto shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={13} /></button>
        </div>
      ) : (
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input id={id} value={texto} onFocus={() => setAberto(true)} onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
            placeholder={placeholder ?? "Buscar no ERP por nome ou código"}
            className={cn("w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-7 pr-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]", className)} />
        </div>
      )}

      {aberto && valor == null && (
        <div className="absolute z-50 mt-1 max-h-64 w-full min-w-72 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {buscando && lista.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]"><Loader2 size={12} className="mr-1 inline animate-spin" />buscando…</p>
          ) : lista.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">Nada encontrado no cadastro do ERP.</p>
          ) : lista.map((p) => (
            <button key={p.cd_pessoa} type="button" onClick={() => escolher(p)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[#EDEDFA] dark:hover:bg-[#191934]">
              <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{p.cd_pessoa}</span>
              <span className="truncate text-[var(--text)]">{p.nome}</span>
              {p.titulos > 0 && <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">{p.titulos} tít.</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
