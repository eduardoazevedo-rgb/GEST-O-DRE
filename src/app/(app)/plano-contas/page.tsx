"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useEmpresa } from "@/context/EmpresaContext";
import { useToast } from "@/context/ToastContext";
import { formatNumero } from "@/lib/labels";
import Button from "@/components/ui/Button";
import type { DeParaConta, DreResposta, PlanoConta } from "@/lib/types";


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

export default function PlanoContasPage() {
  const { empresaId: EMPRESA_ID } = useEmpresa();
  const [plano, setPlano] = useState<PlanoConta[]>([]);
  const [dePara, setDePara] = useState<DeParaConta[]>([]);
  const [naoMapeado, setNaoMapeado] = useState<DreResposta["naoMapeado"]>([]);
  const [mapeando, setMapeando] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const filePlanoRef = useRef<HTMLInputElement>(null);
  const fileDeParaRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();

  const carregar = useCallback(async () => {
    setCarregando(true);
    const planoTudo: PlanoConta[] = [];
    for (let de = 0; ; de += 1000) {
      const { data } = await supabase
        .from("plano_contas").select("*").eq("empresa_id", EMPRESA_ID)
        .order("codigo").range(de, de + 999);
      planoTudo.push(...((data ?? []) as PlanoConta[]));
      if ((data ?? []).length < 1000) break;
    }
    setPlano(planoTudo.sort((a, b) => comparaCodigos(a.codigo, b.codigo)));

    const dpTudo: DeParaConta[] = [];
    for (let de = 0; ; de += 1000) {
      const { data } = await supabase
        .from("de_para_contas").select("*").eq("empresa_id", EMPRESA_ID)
        .order("cd_classificacao_erp").range(de, de + 999);
      dpTudo.push(...((data ?? []) as DeParaConta[]));
      if ((data ?? []).length < 1000) break;
    }
    setDePara(dpTudo);

    try {
      const res = await fetch(`/api/dre?ano=${new Date().getFullYear()}`);
      const json = await res.json();
      if (res.ok) setNaoMapeado(json.naoMapeado ?? []);
    } catch {
      // realizado ainda não sincronizado — sem problema
    }
    setCarregando(false);
  }, [supabase, EMPRESA_ID]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function importarPlano(file: File) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer());
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true });
    const registros: Omit<PlanoConta, "id">[] = [];
    for (const l of linhas) {
      const codigo = String(l["CODIGO"] ?? l["codigo"] ?? l["Código"] ?? "").trim().replace(/\.$/, "");
      const nome = String(l["NOME"] ?? l["nome"] ?? l["Nome"] ?? "").trim();
      if (!codigo || !nome || !/^\d+(\.\d+)+$/.test(codigo)) continue;
      const naturezaBruta = Number(l["NATUREZA"] ?? l["natureza"] ?? -1);
      registros.push({
        empresa_id: EMPRESA_ID,
        codigo,
        nome,
        nivel: codigo.split(".").length,
        natureza: naturezaBruta >= 0 ? 1 : -1,
        exibir_dre: String(l["EXIBIR"] ?? "S").trim().toUpperCase() !== "N",
      });
    }
    if (registros.length === 0) {
      toast("Nenhuma linha válida. A planilha precisa das colunas CODIGO e NOME.", "error");
      return;
    }
    const { error } = await supabase
      .from("plano_contas")
      .upsert(registros, { onConflict: "empresa_id,codigo" });
    if (error) toast(`Erro ao importar: ${error.message}`, "error");
    else {
      toast(`${registros.length} conta(s) importada(s)/atualizada(s).`, "success");
      carregar();
    }
  }

  async function importarDePara(file: File) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer());
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true });
    const registros: Omit<DeParaConta, "id">[] = [];
    for (const l of linhas) {
      const de = String(l["CLASSIFICACAO_ERP"] ?? l["classificacao_erp"] ?? l["DE"] ?? "").trim();
      const para = String(l["CODIGO_GERENCIAL"] ?? l["codigo_gerencial"] ?? l["PARA"] ?? "").trim().replace(/\.$/, "");
      if (!de || !para) continue;
      registros.push({ empresa_id: EMPRESA_ID, cd_classificacao_erp: de, codigo_gerencial: para });
    }
    if (registros.length === 0) {
      toast("Nenhuma linha válida. Colunas esperadas: CLASSIFICACAO_ERP e CODIGO_GERENCIAL.", "error");
      return;
    }
    const { error } = await supabase
      .from("de_para_contas")
      .upsert(registros, { onConflict: "empresa_id,cd_classificacao_erp" });
    if (error) toast(`Erro ao importar: ${error.message}`, "error");
    else {
      toast(`${registros.length} mapeamento(s) importado(s).`, "success");
      carregar();
    }
  }

  async function mapear(cdErp: string) {
    const destino = mapeando[cdErp];
    if (!destino) return;
    const { error } = await supabase
      .from("de_para_contas")
      .upsert(
        [{ empresa_id: EMPRESA_ID, cd_classificacao_erp: cdErp, codigo_gerencial: destino }],
        { onConflict: "empresa_id,cd_classificacao_erp" }
      );
    if (error) toast(`Erro: ${error.message}`, "error");
    else {
      toast(`${cdErp} mapeada para ${destino}.`, "success");
      carregar();
    }
  }

  const deParaPorGerencial = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dePara) m.set(d.codigo_gerencial, (m.get(d.codigo_gerencial) ?? 0) + 1);
    return m;
  }, [dePara]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-[var(--text)]">Plano de Contas Gerencial</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <input
            ref={filePlanoRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importarPlano(f); e.target.value = ""; }}
          />
          <Button variant="secondary" size="sm" onClick={() => filePlanoRef.current?.click()}>
            <Upload size={14} /> Importar plano (CODIGO, NOME)
          </Button>
          <input
            ref={fileDeParaRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importarDePara(f); e.target.value = ""; }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileDeParaRef.current?.click()}>
            <Link2 size={14} /> Importar de-para (CLASSIFICACAO_ERP, CODIGO_GERENCIAL)
          </Button>
        </div>
      </div>

      {naoMapeado.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {naoMapeado.length} conta(s) do ERP com movimento e sem de-para
          </p>
          <div className="max-h-80 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-amber-800 dark:text-amber-300">
                  <th className="py-1 pr-3">Classificação ERP</th>
                  <th className="py-1 pr-3">Conta ERP</th>
                  <th className="py-1 pr-3 text-right">Total no ano</th>
                  <th className="py-1 pr-3">Mapear para</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {naoMapeado.map((n) => (
                  <tr key={n.cd_classificacao_erp} className="border-t border-amber-200 dark:border-amber-900">
                    <td className="py-1 pr-3 font-mono">{n.cd_classificacao_erp}</td>
                    <td className="py-1 pr-3">{n.ds_conta_erp}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${n.total < 0 ? "text-red-600" : ""}`}>
                      {formatNumero(n.total)}
                    </td>
                    <td className="py-1 pr-3">
                      <select
                        value={mapeando[n.cd_classificacao_erp] ?? ""}
                        onChange={(e) => setMapeando((prev) => ({ ...prev, [n.cd_classificacao_erp]: e.target.value }))}
                        className="max-w-72 rounded border border-amber-300 bg-white dark:bg-slate-900 px-2 py-1"
                      >
                        <option value="">— escolher conta gerencial —</option>
                        {plano.filter((p) => p.exibir_dre).map((p) => (
                          <option key={p.codigo} value={p.codigo}>{p.codigo}. {p.nome}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1">
                      <Button size="sm" variant="secondary" onClick={() => mapear(n.cd_classificacao_erp)} disabled={!mapeando[n.cd_classificacao_erp]}>
                        Mapear
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-[#0000C2] text-white">
              <th className="px-3 py-2 text-left font-semibold">Conta gerencial</th>
              <th className="px-3 py-2 text-center font-semibold">Nível</th>
              <th className="px-3 py-2 text-center font-semibold">Natureza</th>
              <th className="px-3 py-2 text-center font-semibold">No DRE</th>
              <th className="px-3 py-2 text-center font-semibold">Contas ERP vinculadas</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-[var(--text-muted)]">Carregando…</td></tr>
            )}
            {!carregando && plano.map((p) => (
              <tr key={p.codigo} className="border-t border-[var(--border)] hover:bg-[var(--bg)]">
                <td className="whitespace-nowrap px-3 py-1.5" style={{ paddingLeft: `${(p.nivel - 1) * 14}px` }}>
                  <span className={p.nivel === 2 ? "font-semibold" : ""}>{p.codigo}. {p.nome}</span>
                </td>
                <td className="px-3 py-1.5 text-center">N{p.nivel}</td>
                <td className="px-3 py-1.5 text-center">{p.natureza >= 0 ? "Receita (+)" : "Despesa (−)"}</td>
                <td className="px-3 py-1.5 text-center">{p.exibir_dre ? "Sim" : "Não"}</td>
                <td className="px-3 py-1.5 text-center">{deParaPorGerencial.get(p.codigo) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
