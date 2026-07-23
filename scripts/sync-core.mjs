// Núcleo de sincronização ERP (Firebird, somente leitura) → Supabase.
// Modos:
//   - full: reprocessa ano(s) inteiro(s) (delete+insert por competência do ano).
//   - incremental: usa o marcador NR_LANCAMENTO (PK, indexado) p/ achar o que
//     entrou desde a última sync, descobre os MESES tocados (inclusive
//     retro-datados) e reprocessa só esses meses. Marcador = max(NR_LANCAMENTO).
// Sinal: crédito - débito (receitas +, despesas -). Mantém cd_pessoa (fornecedor).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const PROJ = "c:/Users/Administrator/Documents/GESTAO-DRE";
const req = createRequire(PROJ + "/package.json");
const Firebird = req("node-firebird");
const { createClient } = req("@supabase/supabase-js");

export const EMPRESA_ID = 1;

export function carregarEnv() {
  const env = {};
  for (const l of readFileSync(PROJ + "/.env.local", "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

export function criarSupabase(env) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function criarFirebird(env) {
  const opt = {
    host: env.FIREBIRD_HOST, port: Number(env.FIREBIRD_PORT ?? 3050), database: env.FIREBIRD_DATABASE,
    user: env.FIREBIRD_USER, password: env.FIREBIRD_PASSWORD, lowercase_keys: false,
    encoding: env.FIREBIRD_CHARSET || "ISO8859_1",
  };
  const query = (sql) => new Promise((res, rej) => {
    if (!/^\s*(select|with)\b/i.test(sql)) return rej(new Error("Bloqueado: apenas SELECT no ERP."));
    Firebird.attach(opt, (e, db) => {
      if (e) return rej(e);
      db.query(sql, [], (er, r) => { db.detach(); er ? rej(er) : res(r); });
    });
  });
  return { query };
}

export function excluidas(env) {
  const raw = env.FIREBIRD_EXCLUIR_EMPRESAS ?? "2000,4000";
  const nums = raw.split(",").map((s) => Number(s.trim())).filter(Number.isInteger);
  return nums.length > 0 ? nums.join(",") : "0";
}

const br = (y, mo, d) => `${String(d).padStart(2, "0")}.${String(mo).padStart(2, "0")}.${y}`;

// SQL de agregação (grão fornecedor) para um intervalo [inicio, fimExclusivo).
function sqlAgregacao(iniBR, fimExclBR, exc) {
  const filtro = `m.dt_lancamento >= '${iniBR}' AND m.dt_lancamento < '${fimExclBR}'
      AND m.cd_empresa NOT IN (${exc}) AND m.tp_docto <> 'A'
      AND (p.cd_classificacao LIKE '3.%' OR p.cd_classificacao LIKE '4.%'
           OR p.cd_classificacao LIKE '5.%' OR p.cd_classificacao LIKE '6.%')`;
  return `
    SELECT X.CD_EMPRESA, X.ANO, X.MES, X.CONTA, X.CD_CLASSIFICACAO, X.DS_CONTA, X.CD_PESSOA,
           SUM(X.VL_CREDITO) - SUM(X.VL_DEBITO) SALDO
    FROM (
      SELECT m.cd_empresa, EXTRACT(YEAR FROM m.dt_lancamento) ano, EXTRACT(MONTH FROM m.dt_lancamento) mes,
             m.cd_contacredito conta, p.cd_classificacao, p.ds_conta, m.cd_pessoa,
             SUM(m.vl_lancamento) vl_credito, 0 vl_debito
      FROM movtocontabil m INNER JOIN planocontas p ON p.cd_conta = m.cd_contacredito
      WHERE ${filtro}
      GROUP BY 1,2,3,4,5,6,7
      UNION ALL
      SELECT m.cd_empresa, EXTRACT(YEAR FROM m.dt_lancamento), EXTRACT(MONTH FROM m.dt_lancamento),
             m.cd_contadebito, p.cd_classificacao, p.ds_conta, m.cd_pessoa, 0, SUM(m.vl_lancamento)
      FROM movtocontabil m INNER JOIN planocontas p ON p.cd_conta = m.cd_contadebito
      WHERE ${filtro}
      GROUP BY 1,2,3,4,5,6,7
    ) X
    GROUP BY X.CD_EMPRESA, X.ANO, X.MES, X.CONTA, X.CD_CLASSIFICACAO, X.DS_CONTA, X.CD_PESSOA`;
}

function mapRegistros(rows) {
  return rows
    .filter((r) => Number(r.SALDO) !== 0)
    .map((r) => ({
      empresa_id: EMPRESA_ID,
      cd_empresa_erp: Number(r.CD_EMPRESA),
      competencia: `${r.ANO}-${String(r.MES).padStart(2, "0")}-01`,
      cd_conta_erp: Number(r.CONTA),
      cd_classificacao_erp: String(r.CD_CLASSIFICACAO).trim(),
      ds_conta_erp: String(r.DS_CONTA ?? "").trim(),
      cd_pessoa: r.CD_PESSOA != null ? Number(r.CD_PESSOA) : null,
      valor: Number(r.SALDO),
      sincronizado_em: new Date().toISOString(),
    }));
}

async function inserirLote(supabase, tabela, registros, onConflict) {
  for (let i = 0; i < registros.length; i += 500) {
    const slice = registros.slice(i, i + 500);
    const r = onConflict
      ? await supabase.from(tabela).upsert(slice, { onConflict })
      : await supabase.from(tabela).insert(slice);
    if (r.error) throw new Error(`Supabase (${tabela}): ${r.error.message}`);
  }
}

// Popula a dimensão fornecedores (nomes de pessoa) p/ os cd_pessoa usados.
async function upsertFornecedores(supabase, fb, cdPessoas) {
  const usados = [...cdPessoas].filter((v) => v != null);
  if (usados.length === 0) return;
  const pessoas = await fb.query("SELECT cd_pessoa, nm_pessoa FROM pessoa");
  const nomePorCd = new Map();
  for (const p of pessoas) {
    if (p.CD_PESSOA == null) continue;
    const cd = Number(p.CD_PESSOA);
    if (nomePorCd.has(cd)) continue;
    const nome = String(p.NM_PESSOA ?? "").trim();
    if (nome) nomePorCd.set(cd, nome);
  }
  const forn = usados.map((cd) => ({ cd_pessoa: cd, nome: nomePorCd.get(cd) ?? `Pessoa ${cd}` }));
  await inserirLote(supabase, "fornecedores", forn, "cd_pessoa");
}

async function refreshMV(supabase) {
  const { error } = await supabase.rpc("refresh_realizado_mv");
  if (error) console.warn(`[sync] aviso: MV não atualizada: ${error.message}`);
}

async function maxNrLancamento(fb) {
  const r = await fb.query("SELECT MAX(nr_lancamento) MX FROM movtocontabil");
  return r[0]?.MX != null ? Number(r[0].MX) : 0;
}

async function atualizarEstado(supabase, patch) {
  const { error } = await supabase.from("sync_estado").update(patch).eq("id", 1);
  if (error) throw new Error(`Supabase (sync_estado): ${error.message}`);
}

// Lock de execução (evita duas syncs ao mesmo tempo). Atômico via UPDATE
// condicional; considera lock antigo (> minutos) como travado/expirado.
export async function claimLock(supabase, minutes = 30) {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  const { data } = await supabase.from("sync_estado")
    .update({ em_execucao_desde: new Date().toISOString() })
    .eq("id", 1)
    .or(`em_execucao_desde.is.null,em_execucao_desde.lt.${cutoff}`)
    .select();
  return !!(data && data.length);
}
export async function releaseLock(supabase) {
  await supabase.from("sync_estado").update({ em_execucao_desde: null }).eq("id", 1);
}

// Reprocessa uma competência (ano, mes): agrega no Firebird, apaga e reinsere.
async function reprocessarMes(supabase, fb, exc, ano, mes) {
  const iniBR = br(ano, mes, 1);
  const fimExclBR = mes === 12 ? br(ano + 1, 1, 1) : br(ano, mes + 1, 1);
  const rows = await fb.query(sqlAgregacao(iniBR, fimExclBR, exc));
  const registros = mapRegistros(rows);
  const competencia = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const del = await supabase.from("realizado_erp").delete()
    .eq("empresa_id", EMPRESA_ID).eq("competencia", competencia);
  if (del.error) throw new Error(`Supabase (delete ${competencia}): ${del.error.message}`);
  await inserirLote(supabase, "realizado_erp", registros);
  return registros;
}

// Ajustes de inventário (Auditoria): movestoque ops 998/999, agregado por
// empresa × mês × item × seção/grupo/marca × histórico × tipo. Substitui o ano.
export async function sincronizarAjustes(supabase, fb, exc, ano) {
  const iniBR = br(ano, 1, 1), fimExclBR = br(ano + 1, 1, 1);
  const sql = `
    SELECT m.cd_empresa CD_EMPRESA, EXTRACT(YEAR FROM m.dt_lancamento) ANO, EXTRACT(MONTH FROM m.dt_lancamento) MES,
      m.cd_item CD_ITEM, i.ds_item DS_ITEM,
      i.cd_secao CD_SECAO, s.ds_secao DS_SECAO,
      i.cd_grupo CD_GRUPO, g.ds_grupo DS_GRUPO,
      i.cd_marca CD_MARCA, mc.ds_marca DS_MARCA,
      m.cd_historico CD_HISTORICO, hh.ds_historico DS_HISTORICO,
      o.tp_operacao TP_OPERACAO,
      SUM(CASE o.tp_operacao WHEN 'E' THEN m.qt_estoque ELSE m.qt_estoque * -1 END) QTD,
      SUM(CASE o.tp_operacao WHEN 'E' THEN m.vl_estoque ELSE m.vl_estoque * -1 END) VL
    FROM movestoque m
    INNER JOIN operacao o ON m.cd_operacao = o.cd_operacao
    LEFT JOIN historico hh ON hh.cd_historico = m.cd_historico
    LEFT JOIN item i ON i.cd_item = m.cd_item
    LEFT JOIN marca mc ON i.cd_marca = mc.cd_marca
    LEFT JOIN grupo g ON i.cd_grupo = g.cd_grupo
    LEFT JOIN secao s ON i.cd_secao = s.cd_secao
    WHERE m.cd_operacao IN (998, 999) AND m.st_cancelamento = 'N'
      AND m.dt_lancamento >= '${iniBR}' AND m.dt_lancamento < '${fimExclBR}'
      AND m.cd_empresa NOT IN (${exc})
    GROUP BY 1, 2, 3, m.cd_item, i.ds_item, i.cd_secao, s.ds_secao, i.cd_grupo, g.ds_grupo,
             i.cd_marca, mc.ds_marca, m.cd_historico, hh.ds_historico, o.tp_operacao`;
  const rows = await fb.query(sql);
  const txt = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
  const num = (v) => (v != null && v !== "" ? Number(v) : null);
  const registros = rows
    .filter((r) => Number(r.QTD) !== 0 || Number(r.VL) !== 0)
    .map((r) => ({
      ano: Number(r.ANO), mes: Number(r.MES), cd_empresa: Number(r.CD_EMPRESA),
      cd_item: num(r.CD_ITEM), ds_item: txt(r.DS_ITEM),
      cd_secao: num(r.CD_SECAO), ds_secao: txt(r.DS_SECAO),
      cd_grupo: num(r.CD_GRUPO), ds_grupo: txt(r.DS_GRUPO),
      cd_marca: num(r.CD_MARCA), ds_marca: txt(r.DS_MARCA),
      cd_historico: num(r.CD_HISTORICO), ds_historico: txt(r.DS_HISTORICO),
      tp_operacao: txt(r.TP_OPERACAO), qtd: Number(r.QTD), vl: Number(r.VL),
      sincronizado_em: new Date().toISOString(),
    }));
  const del = await supabase.from("ajustes_inventario").delete().eq("ano", ano);
  if (del.error) throw new Error(`Supabase (ajustes delete): ${del.error.message}`);
  await inserirLote(supabase, "ajustes_inventario", registros);
  return registros.length;
}

// ---- Modos ----

// full: reprocessa o ano inteiro (mês a mês, reaproveitando reprocessarMes).
export async function executarFull(supabase, fb, exc, ano) {
  const cdPessoas = new Set();
  let total = 0;
  for (let mes = 1; mes <= 12; mes++) {
    const regs = await reprocessarMes(supabase, fb, exc, ano, mes);
    for (const r of regs) if (r.cd_pessoa != null) cdPessoas.add(r.cd_pessoa);
    total += regs.length;
  }
  await upsertFornecedores(supabase, fb, cdPessoas);
  const maxNr = await maxNrLancamento(fb);
  const { data: mc } = await supabase.from("realizado_erp")
    .select("competencia").eq("empresa_id", EMPRESA_ID).order("competencia", { ascending: false }).limit(1);
  await atualizarEstado(supabase, {
    ultimo_nr_lancamento: maxNr,
    ultima_competencia: mc?.[0]?.competencia ?? null,
    atualizado_em: new Date().toISOString(),
  });
  await refreshMV(supabase);
  await sincronizarAjustes(supabase, fb, exc, ano);
  return { linhas: total, meses: 12, maxNr };
}

// incremental: delta por NR_LANCAMENTO → meses tocados → reprocessa só eles.
export async function executarIncremental(supabase, fb, exc) {
  const { data: est } = await supabase.from("sync_estado").select("ultimo_nr_lancamento").eq("id", 1).single();
  const desde = est?.ultimo_nr_lancamento != null ? Number(est.ultimo_nr_lancamento) : null;
  if (desde == null) {
    // sem marcador: faz full do ano corrente e marca
    return executarFull(supabase, fb, exc, new Date().getFullYear());
  }
  const maxNr = await maxNrLancamento(fb);

  // meses (competências) tocados por lançamentos novos desde o marcador
  const tocados = await fb.query(`
    SELECT DISTINCT EXTRACT(YEAR FROM dt_lancamento) ANO, EXTRACT(MONTH FROM dt_lancamento) MES
    FROM movtocontabil
    WHERE nr_lancamento > ${desde}
      AND cd_empresa NOT IN (${exc}) AND tp_docto <> 'A'`);
  const meses = tocados
    .map((r) => ({ ano: Number(r.ANO), mes: Number(r.MES) }))
    .filter((x) => x.ano >= 2000 && x.mes >= 1 && x.mes <= 12);

  const cdPessoas = new Set();
  let total = 0;
  for (const { ano, mes } of meses) {
    const regs = await reprocessarMes(supabase, fb, exc, ano, mes);
    for (const r of regs) if (r.cd_pessoa != null) cdPessoas.add(r.cd_pessoa);
    total += regs.length;
  }
  await upsertFornecedores(supabase, fb, cdPessoas);

  const { data: mc } = await supabase.from("realizado_erp")
    .select("competencia").eq("empresa_id", EMPRESA_ID).order("competencia", { ascending: false }).limit(1);
  await atualizarEstado(supabase, {
    ultimo_nr_lancamento: maxNr,
    ultima_competencia: mc?.[0]?.competencia ?? null,
    atualizado_em: new Date().toISOString(),
  });
  if (meses.length > 0) await refreshMV(supabase);
  // Ajustes de inventário: resincroniza o ano corrente (subconjunto pequeno).
  await sincronizarAjustes(supabase, fb, exc, new Date().getFullYear());
  return { linhas: total, meses: meses.length, maxNr };
}
