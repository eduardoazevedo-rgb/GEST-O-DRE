// Sincroniza o realizado do ERP (Firebird, somente leitura) para o Supabase.
// Roda em uma máquina da rede da empresa (a nuvem não alcança o Firebird):
//   npm run sync            -> ano atual
//   npm run sync -- 2025    -> ano específico
// Agendável pelo Agendador de Tarefas do Windows.
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
dotenv();
import Firebird from "node-firebird";
import { createClient } from "@supabase/supabase-js";

const EMPRESA_ID = 1; // HOFF

const ano = Number(process.argv[2] ?? new Date().getFullYear());
if (!Number.isInteger(ano) || ano < 2000 || ano > 2099) {
  console.error(`Ano inválido: ${process.argv[2]}`);
  process.exit(1);
}

const obrigatoria = (nome) => {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não definida (confira o .env.local)`);
  return v;
};

const fbOptions = {
  host: obrigatoria("FIREBIRD_HOST"),
  port: Number(process.env.FIREBIRD_PORT ?? 3050),
  database: obrigatoria("FIREBIRD_DATABASE"),
  user: obrigatoria("FIREBIRD_USER"),
  password: obrigatoria("FIREBIRD_PASSWORD"),
  lowercase_keys: false,
  encoding: process.env.FIREBIRD_CHARSET || "ISO8859_1",
};

function queryFirebird(sql) {
  if (!/^\s*(select|with)\b/i.test(sql)) {
    return Promise.reject(new Error("Bloqueado: apenas SELECT no banco do ERP."));
  }
  return new Promise((resolve, reject) => {
    Firebird.attach(fbOptions, (errAttach, db) => {
      if (errAttach) return reject(errAttach);
      db.query(sql, [], (errQuery, result) => {
        db.detach();
        if (errQuery) return reject(errQuery);
        resolve(result);
      });
    });
  });
}

// Filiais do ERP a ignorar. Vazio = traz todas (2000/4000 agora são empresas
// próprias no portal — LDK2 e DMCL — e não devem mais ser excluídas).
function empresasExcluidas() {
  const raw = process.env.FIREBIRD_EXCLUIR_EMPRESAS ?? "";
  const nums = raw.split(",").map((s) => Number(s.trim())).filter(Number.isInteger);
  return nums.length > 0 ? nums.join(",") : "0";
}

const supabase = createClient(
  obrigatoria("NEXT_PUBLIC_SUPABASE_URL"),
  obrigatoria("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

const excluidas = empresasExcluidas();
const dtInicio = `01.01.${ano}`;
const dtFim = `31.12.${ano}`;

// Mesma consulta de src/lib/dre/sync.ts — manter os dois em dia se mudar.
// Mantém cd_pessoa no grão (para a visão de Custo por Fornecedor). A DRE
// agrega por cima e ignora o fornecedor, então os totais não mudam.
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

const sqlPessoas = `SELECT cd_pessoa, nm_pessoa FROM pessoa`;

console.log(`[sync] Consultando ERP (${fbOptions.host}) — realizado de ${ano}…`);
const inicio = Date.now();
const { data: log } = await supabase.from("sync_log").insert({ ano, status: "executando" }).select("id").single();

try {
  // cd_empresa (ERP) → empresa_id (portal): 1000–1024 = HOFF, 2000 = LDK2, 4000 = DMCL.
  const { data: filiais, error: errFiliais } = await supabase.from("filiais").select("cd_empresa, empresa_id");
  if (errFiliais) throw new Error(`Supabase (filiais): ${errFiliais.message}`);
  const empresaDe = new Map((filiais ?? []).map((f) => [Number(f.cd_empresa), Number(f.empresa_id)]));
  const empresaIds = [...new Set([EMPRESA_ID, ...empresaDe.values()])];

  const rows = await queryFirebird(sql);
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

  // Dimensão de fornecedores: nomes (de pessoa) dos cd_pessoa usados, deduplicado.
  const usados = new Set(registros.map((r) => r.cd_pessoa).filter((v) => v != null));
  const pessoas = await queryFirebird(sqlPessoas);
  const nomePorCd = new Map();
  for (const p of pessoas) {
    if (p.CD_PESSOA == null) continue;
    const cd = Number(p.CD_PESSOA);
    if (!usados.has(cd) || nomePorCd.has(cd)) continue;
    const nome = String(p.NM_PESSOA ?? "").trim();
    if (nome) nomePorCd.set(cd, nome);
  }
  const fornecedores = [...usados].map((cd) => ({ cd_pessoa: cd, nome: nomePorCd.get(cd) ?? `Pessoa ${cd}` }));

  console.log(`[sync] ${registros.length} linha(s), ${fornecedores.length} fornecedor(es). Gravando no Supabase…`);

  for (let i = 0; i < fornecedores.length; i += 500) {
    const { error } = await supabase.from("fornecedores").upsert(fornecedores.slice(i, i + 500), { onConflict: "cd_pessoa" });
    if (error) throw new Error(`Supabase (fornecedores): ${error.message}`);
  }

  const { error: delError } = await supabase
    .from("realizado_erp")
    .delete()
    .in("empresa_id", empresaIds)
    .gte("competencia", `${ano}-01-01`)
    .lte("competencia", `${ano}-12-31`);
  if (delError) throw new Error(`Supabase (delete): ${delError.message}`);

  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase.from("realizado_erp").insert(registros.slice(i, i + 500));
    if (error) throw new Error(`Supabase (insert): ${error.message}`);
  }

  // Atualiza a view materializada que o DRE lê (agregada sem fornecedor).
  const { error: mvError } = await supabase.rpc("refresh_realizado_mv");
  if (mvError) console.warn(`[sync] aviso: falha ao atualizar MV do DRE: ${mvError.message}`);

  if (log) {
    await supabase
      .from("sync_log")
      .update({ status: "ok", linhas: registros.length, finalizado_em: new Date().toISOString() })
      .eq("id", log.id);
  }
  console.log(`[sync] OK em ${((Date.now() - inicio) / 1000).toFixed(1)}s.`);
} catch (err) {
  const mensagem = err instanceof Error ? err.message : String(err);
  if (log) {
    await supabase
      .from("sync_log")
      .update({ status: "erro", mensagem, finalizado_em: new Date().toISOString() })
      .eq("id", log.id);
  }
  console.error(`[sync] ERRO: ${mensagem}`);
  process.exit(1);
}
