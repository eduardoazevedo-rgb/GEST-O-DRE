import { queryFirebird } from "@/lib/firebird/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sincroniza o realizado do ERP (Firebird HOFF50.FDB, somente leitura) para a
 * tabela realizado_erp do Supabase, agregado por mês × conta × filial.
 * Convenção de sinal: crédito - débito (receitas +, despesas -).
 */

const EMPRESA_ID = 1; // HOFF

interface LinhaErp {
  CD_EMPRESA: number;
  ANO: number;
  MES: number;
  CONTA: number;
  CD_CLASSIFICACAO: string;
  DS_CONTA: string;
  CD_PESSOA: number | null;
  SALDO: number;
}

// Vazio = traz todas as filiais (2000 = LDK2 e 4000 = DMCL são empresas
// próprias no portal desde a migração 022).
function empresasExcluidas(): string {
  const raw = process.env.FIREBIRD_EXCLUIR_EMPRESAS ?? "";
  const nums = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
  return nums.length > 0 ? nums.join(",") : "0";
}

export async function sincronizarRealizado(ano: number): Promise<{ linhas: number }> {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) {
    throw new Error(`Ano inválido: ${ano}`);
  }
  const dtInicio = `01.01.${ano}`;
  const dtFim = `31.12.${ano}`;
  const excluidas = empresasExcluidas();

  const sql = `
    SELECT X.CD_EMPRESA, X.ANO, X.MES, X.CONTA, X.CD_CLASSIFICACAO, X.DS_CONTA, X.CD_PESSOA,
           SUM(X.VL_CREDITO) - SUM(X.VL_DEBITO) SALDO
    FROM (
      SELECT m.cd_empresa,
             EXTRACT(YEAR FROM m.dt_lancamento) ano,
             EXTRACT(MONTH FROM m.dt_lancamento) mes,
             m.cd_contacredito conta, p.cd_classificacao, p.ds_conta, m.cd_pessoa,
             SUM(m.vl_lancamento) vl_credito, 0 vl_debito
      FROM movtocontabil m
      INNER JOIN planocontas p ON p.cd_conta = m.cd_contacredito
      WHERE m.dt_lancamento BETWEEN '${dtInicio}' AND '${dtFim}'
        AND m.cd_empresa NOT IN (${excluidas})
        AND m.tp_docto <> 'A'
        AND (p.cd_classificacao LIKE '3.%' OR p.cd_classificacao LIKE '4.%'
             OR p.cd_classificacao LIKE '5.%' OR p.cd_classificacao LIKE '6.%')
      GROUP BY 1, 2, 3, 4, 5, 6, 7

      UNION ALL

      SELECT m.cd_empresa,
             EXTRACT(YEAR FROM m.dt_lancamento) ano,
             EXTRACT(MONTH FROM m.dt_lancamento) mes,
             m.cd_contadebito conta, p.cd_classificacao, p.ds_conta, m.cd_pessoa,
             0 vl_credito, SUM(m.vl_lancamento) vl_debito
      FROM movtocontabil m
      INNER JOIN planocontas p ON p.cd_conta = m.cd_contadebito
      WHERE m.dt_lancamento BETWEEN '${dtInicio}' AND '${dtFim}'
        AND m.cd_empresa NOT IN (${excluidas})
        AND m.tp_docto <> 'A'
        AND (p.cd_classificacao LIKE '3.%' OR p.cd_classificacao LIKE '4.%'
             OR p.cd_classificacao LIKE '5.%' OR p.cd_classificacao LIKE '6.%')
      GROUP BY 1, 2, 3, 4, 5, 6, 7
    ) X
    GROUP BY X.CD_EMPRESA, X.ANO, X.MES, X.CONTA, X.CD_CLASSIFICACAO, X.DS_CONTA, X.CD_PESSOA
  `;

  const rows = await queryFirebird<LinhaErp>(sql);

  // cd_empresa (ERP) → empresa_id (portal): 1000–1024 = HOFF, 2000 = LDK2, 4000 = DMCL.
  const supabaseMapa = createAdminClient();
  const { data: filiais, error: errFiliais } = await supabaseMapa.from("filiais").select("cd_empresa, empresa_id");
  if (errFiliais) throw new Error(`Supabase (filiais): ${errFiliais.message}`);
  const empresaDe = new Map((filiais ?? []).map((f) => [Number(f.cd_empresa), Number(f.empresa_id)]));
  const empresaIds = [...new Set([EMPRESA_ID, ...empresaDe.values()])];

  const registros = rows
    .filter((r) => Number(r.SALDO) !== 0)
    .map((r) => ({
      empresa_id: empresaDe.get(Number(r.CD_EMPRESA)) ?? EMPRESA_ID,
      cd_empresa_erp: Number(r.CD_EMPRESA),
      competencia: `${r.ANO}-${String(r.MES).padStart(2, "0")}-01`,
      cd_conta_erp: Number(r.CONTA),
      cd_classificacao_erp: String(r.CD_CLASSIFICACAO).trim(),
      ds_conta_erp: String(r.DS_CONTA).trim(),
      cd_pessoa: r.CD_PESSOA != null ? Number(r.CD_PESSOA) : null,
      valor: Number(r.SALDO),
      sincronizado_em: new Date().toISOString(),
    }));

  const supabase = createAdminClient();

  // Dimensão de fornecedores (nomes de pessoa), deduplicada.
  const usados = new Set(registros.map((r) => r.cd_pessoa).filter((v): v is number => v != null));
  if (usados.size > 0) {
    const pessoas = await queryFirebird<{ CD_PESSOA: number | null; NM_PESSOA: string | null }>(
      "SELECT cd_pessoa, nm_pessoa FROM pessoa"
    );
    const nomePorCd = new Map<number, string>();
    for (const p of pessoas) {
      if (p.CD_PESSOA == null) continue;
      const cd = Number(p.CD_PESSOA);
      if (!usados.has(cd) || nomePorCd.has(cd)) continue;
      const nome = String(p.NM_PESSOA ?? "").trim();
      if (nome) nomePorCd.set(cd, nome);
    }
    const fornecedores = [...usados].map((cd) => ({ cd_pessoa: cd, nome: nomePorCd.get(cd) ?? `Pessoa ${cd}` }));
    for (let i = 0; i < fornecedores.length; i += 500) {
      const { error } = await supabase.from("fornecedores").upsert(fornecedores.slice(i, i + 500), { onConflict: "cd_pessoa" });
      if (error) throw new Error(`Supabase (fornecedores): ${error.message}`);
    }
  }

  // Recarrega o ano inteiro: apaga e insere (evita sobras de contas zeradas)
  const { error: delError } = await supabase
    .from("realizado_erp")
    .delete()
    .in("empresa_id", empresaIds)
    .gte("competencia", `${ano}-01-01`)
    .lte("competencia", `${ano}-12-31`);
  if (delError) throw new Error(`Supabase (delete): ${delError.message}`);

  const LOTE = 500;
  for (let i = 0; i < registros.length; i += LOTE) {
    const { error } = await supabase.from("realizado_erp").insert(registros.slice(i, i + LOTE));
    if (error) throw new Error(`Supabase (insert): ${error.message}`);
  }

  // Atualiza a view materializada que o DRE lê (agregada sem fornecedor).
  const { error: mvError } = await supabase.rpc("refresh_realizado_mv");
  if (mvError) console.warn(`[sync] aviso: falha ao atualizar MV do DRE: ${mvError.message}`);

  return { linhas: registros.length };
}
