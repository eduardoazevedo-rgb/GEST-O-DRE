"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Save, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useEmpresa } from "@/context/EmpresaContext";
import { useToast } from "@/context/ToastContext";
import { MESES_CURTO, formatNumero } from "@/lib/labels";
import Button from "@/components/ui/Button";
import type { OrcamentoVersao, PlanoConta } from "@/lib/types";


/** chave "codigo|mes" -> valor */
type Valores = Map<string, number>;

function chave(codigo: string, mes: number) {
  return `${codigo}|${mes}`;
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

export default function OrcamentoPage() {
  const { empresaId: EMPRESA_ID } = useEmpresa();
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [versoes, setVersoes] = useState<OrcamentoVersao[]>([]);
  const [versaoId, setVersaoId] = useState<string>("");
  const [plano, setPlano] = useState<PlanoConta[]>([]);
  const [valores, setValores] = useState<Valores>(new Map());
  const [alterados, setAlterados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();

  const carregarVersoes = useCallback(async () => {
    const { data, error } = await supabase
      .from("orcamento_versoes")
      .select("*")
      .eq("empresa_id", EMPRESA_ID)
      .eq("ano", ano)
      .order("created_at", { ascending: false });
    if (error) {
      toast(`Erro ao carregar versões: ${error.message}`, "error");
      return;
    }
    setVersoes(data ?? []);
    const ativa = (data ?? []).find((v) => v.ativa) ?? (data ?? [])[0];
    setVersaoId(ativa?.id ?? "");
  }, [ano, supabase, toast, EMPRESA_ID]);

  useEffect(() => {
    carregarVersoes();
  }, [carregarVersoes]);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      const { data: planoData } = await supabase
        .from("plano_contas")
        .select("*")
        .eq("empresa_id", EMPRESA_ID)
        .eq("exibir_dre", true)
        .order("codigo");
      setPlano((planoData ?? []).sort((a, b) => comparaCodigos(a.codigo, b.codigo)));

      const novo: Valores = new Map();
      if (versaoId) {
        // pagina para passar do limite de 1000 linhas
        for (let de = 0; ; de += 1000) {
          const { data } = await supabase
            .from("orcamento_valores")
            .select("codigo_gerencial, mes, valor")
            .eq("versao_id", versaoId)
            .order("codigo_gerencial")
            .range(de, de + 999);
          for (const v of data ?? []) novo.set(chave(v.codigo_gerencial, v.mes), Number(v.valor));
          if ((data ?? []).length < 1000) break;
        }
      }
      setValores(novo);
      setAlterados(new Set());
      setCarregando(false);
    })();
  }, [versaoId, supabase, EMPRESA_ID]);

  async function criarVersao() {
    const nome = window.prompt(`Nome da nova versão do orçamento ${ano}:`, `Orçamento ${ano}`);
    if (!nome) return;
    const { data, error } = await supabase
      .from("orcamento_versoes")
      .insert({ empresa_id: EMPRESA_ID, ano, nome, ativa: versoes.length === 0 })
      .select()
      .single();
    if (error) {
      toast(`Erro ao criar versão: ${error.message}`, "error");
      return;
    }
    toast("Versão criada.", "success");
    await carregarVersoes();
    setVersaoId(data.id);
  }

  async function tornarAtiva() {
    if (!versaoId) return;
    await supabase.from("orcamento_versoes").update({ ativa: false }).eq("empresa_id", EMPRESA_ID).eq("ano", ano);
    const { error } = await supabase.from("orcamento_versoes").update({ ativa: true }).eq("id", versaoId);
    if (error) toast(`Erro: ${error.message}`, "error");
    else {
      toast("Versão definida como ativa (usada no DRE).", "success");
      carregarVersoes();
    }
  }

  function editar(codigo: string, mes: number, texto: string) {
    const valor = Number(texto.replace(/\./g, "").replace(",", "."));
    const k = chave(codigo, mes);
    setValores((prev) => {
      const novo = new Map(prev);
      if (texto.trim() === "" || Number.isNaN(valor)) novo.delete(k);
      else novo.set(k, valor);
      return novo;
    });
    setAlterados((prev) => new Set(prev).add(k));
  }

  async function salvar() {
    if (!versaoId || alterados.size === 0) return;
    setSalvando(true);
    const registros = [...alterados].map((k) => {
      const [codigo, mesStr] = k.split("|");
      return {
        versao_id: versaoId,
        codigo_gerencial: codigo,
        mes: Number(mesStr),
        valor: valores.get(k) ?? 0,
      };
    });
    const { error } = await supabase
      .from("orcamento_valores")
      .upsert(registros, { onConflict: "versao_id,codigo_gerencial,mes" });
    setSalvando(false);
    if (error) toast(`Erro ao salvar: ${error.message}`, "error");
    else {
      toast(`${registros.length} valor(es) salvo(s).`, "success");
      setAlterados(new Set());
    }
  }

  async function importarPlanilha(file: File) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: true });
    const codigosValidos = new Set(plano.map((p) => p.codigo));
    let aplicados = 0;
    let ignorados = 0;

    setValores((prev) => {
      const novo = new Map(prev);
      const marcados = new Set(alterados);
      for (const linha of linhas) {
        const codigo = String(linha["CODIGO"] ?? linha["codigo"] ?? linha["Código"] ?? "").trim().replace(/\.$/, "");
        if (!codigo || !codigosValidos.has(codigo)) {
          if (codigo) ignorados++;
          continue;
        }
        MESES_CURTO.forEach((nomeMes, i) => {
          const bruto =
            linha[nomeMes] ?? linha[nomeMes.toUpperCase()] ?? linha[nomeMes.toLowerCase()] ?? linha[String(i + 1)];
          if (bruto === undefined || bruto === null || bruto === "") return;
          const valor = Number(bruto);
          if (Number.isNaN(valor)) return;
          const k = chave(codigo, i + 1);
          novo.set(k, valor);
          marcados.add(k);
          aplicados++;
        });
      }
      setAlterados(marcados);
      return novo;
    });

    toast(
      `Importação: ${aplicados} valor(es) aplicado(s)${ignorados > 0 ? `, ${ignorados} código(s) fora do plano ignorado(s)` : ""}. Clique em Salvar para gravar.`,
      "success"
    );
  }

  async function baixarModelo() {
    const XLSX = await import("xlsx");
    const dados = plano.map((p) => {
      const linha: Record<string, unknown> = { CODIGO: p.codigo, NOME: p.nome };
      MESES_CURTO.forEach((m) => (linha[m] = ""));
      return linha;
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Orçamento ${ano}`);
    XLSX.writeFile(wb, `modelo_orcamento_${ano}.xlsx`);
  }

  const versaoAtual = versoes.find((v) => v.id === versaoId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-[var(--text)]">Orçamento (Planejado)</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
          >
            {Array.from({ length: 7 }, (_, i) => anoAtual + 2 - i).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            value={versaoId}
            onChange={(e) => setVersaoId(e.target.value)}
            className="max-w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
          >
            {versoes.length === 0 && <option value="">Sem versões</option>}
            {versoes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}{v.ativa ? " (ativa)" : ""}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={criarVersao}>
            <Plus size={14} /> Nova versão
          </Button>
        </div>
      </div>

      {versaoAtual && !versaoAtual.ativa && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          Esta versão não é a ativa — o DRE usa a versão ativa.
          <Button variant="secondary" size="sm" onClick={tornarAtiva}>Tornar ativa</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={baixarModelo}>
          <Download size={14} /> Baixar modelo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importarPlanilha(f);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!versaoId}>
          <Upload size={14} /> Importar planilha
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {alterados.size > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">{alterados.size} alteração(ões) não salva(s)</span>
          )}
          <Button size="sm" onClick={salvar} loading={salvando} disabled={!versaoId || alterados.size === 0}>
            <Save size={14} /> Salvar
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-[#0000C2] text-white">
              <th className="sticky left-0 z-10 bg-[#0000C2] px-3 py-2 text-left font-semibold min-w-56">Conta</th>
              {MESES_CURTO.map((m) => (
                <th key={m} className="border-l border-white/20 px-2 py-2 text-center font-semibold min-w-24">{m}</th>
              ))}
              <th className="border-l border-white/20 px-2 py-2 text-center font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={14} className="px-3 py-8 text-center text-[var(--text-muted)]">Carregando…</td></tr>
            )}
            {!carregando && plano.map((p) => {
              const total = Array.from({ length: 12 }, (_, i) => valores.get(chave(p.codigo, i + 1)) ?? 0).reduce((a, b) => a + b, 0);
              return (
                <tr key={p.codigo} className="border-t border-[var(--border)] hover:bg-[var(--bg)]">
                  <td
                    className="sticky left-0 z-10 whitespace-nowrap bg-[var(--surface)] px-3 py-1"
                    style={{ paddingLeft: `${(p.nivel - 1) * 14}px` }}
                    title={`${p.codigo}. ${p.nome}`}
                  >
                    <span className={p.nivel === 2 ? "font-semibold" : ""}>{p.codigo}. {p.nome}</span>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const k = chave(p.codigo, i + 1);
                    const v = valores.get(k);
                    return (
                      <td key={i} className="border-l border-[var(--border)] p-0">
                        <input
                          type="text"
                          inputMode="decimal"
                          defaultValue={v !== undefined && v !== 0 ? String(v) : ""}
                          onBlur={(e) => editar(p.codigo, i + 1, e.target.value)}
                          className={`w-24 bg-transparent px-2 py-1 text-right tabular-nums text-[var(--text)] outline-none focus:bg-blue-50 dark:focus:bg-blue-950 ${alterados.has(k) ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}
                        />
                      </td>
                    );
                  })}
                  <td className={`border-l border-[var(--border)] px-2 py-1 text-right font-semibold tabular-nums ${total < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                    {total !== 0 ? formatNumero(total) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Dica: lance os valores no nível de conta em que deseja acompanhar (o DRE soma automaticamente os níveis
        superiores). Despesas devem ser lançadas com sinal negativo, como no realizado contábil.
      </p>
    </div>
  );
}
