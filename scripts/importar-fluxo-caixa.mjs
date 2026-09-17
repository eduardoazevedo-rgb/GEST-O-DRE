// Importa a planilha "Fluxo de caixa HOFF" para o Fluxo de Caixa do portal.
//
//   node --env-file=.env.local scripts/importar-fluxo-caixa.mjs "<arquivo.xlsx>" [--substituir]
//
// · cada linha com valor vira um lançamento; cada mês com valor vira uma parcela
//   com vencimento no DIA 1º daquele mês (a planilha só tem o mês);
// · linha 3 (fornecedores) e 202 (clientes) viram premissas mensais;
// · linha 204 vira saldo real de fim de mês, e a abertura de jan (D2) vira o
//   saldo real de dezembro do ano anterior;
// · linhas zeradas por fórmula (ex.: =-5740593+5740593) entram como canceladas;
// · no fim, recalcula o saldo previsto e compara com a linha 203 da planilha.
// Tudo numa transação: ou entra tudo, ou nada. Só lê o arquivo; não toca no ERP.
import { createRequire } from "node:module";
import pg from "pg";

const req = createRequire(import.meta.url);
const XLSX = req("xlsx");

const arquivo = process.argv[2];
const substituir = process.argv.includes("--substituir");
if (!arquivo) { console.error("Informe o caminho da planilha."); process.exit(1); }

const EMPRESA = 1; // HOFF

// Faixas de linhas → bloco (conferidas: a soma dos blocos reproduz a linha 203).
const faixa = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const BLOCO_DA_LINHA = new Map([
  ...faixa(194, 199).map((l) => [l, "recebimentos"]),
  ...faixa(5, 27).map((l) => [l, "estrategicos"]),
  ...faixa(59, 180).map((l) => [l, "investimentos"]),
  ...faixa(32, 45).map((l) => [l, "veiculos"]),
  ...faixa(50, 57).map((l) => [l, "ssma"]),
  ...faixa(47, 48).map((l) => [l, "seguros"]),
  ...faixa(182, 185).map((l) => [l, "financiamentos"]),
  ...[4, 28, 29, 30, ...faixa(187, 193), 200, 201].map((l) => [l, "pessoal_tributos"]),
]);
const LINHA_FORNECEDORES = 3, LINHA_CLIENTES = 202, LINHA_PREVISTO = 203, LINHA_REAL = 204;

const wb = XLSX.readFile(arquivo, { cellFormula: true, cellDates: true });
const nomeAba = wb.SheetNames[0];
const ws = wb.Sheets[nomeAba];
const faixaAba = XLSX.utils.decode_range(ws["!ref"]);
const cel = (l, c) => ws[XLSX.utils.encode_cell({ r: l - 1, c })];

// Colunas de mês: cabeçalho com data na linha 1, a partir da coluna D.
const meses = [];
for (let c = 3; c <= faixaAba.e.c; c++) {
  const h = cel(1, c);
  if (!h || !(h.v instanceof Date)) continue;
  const d = h.v;
  // cellDates devolve meia-noite local deslocada; pega ano/mês somando 12h.
  const ref = new Date(d.getTime() + 12 * 3600 * 1000);
  meses.push({ col: c, iso: `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-01` });
}
if (meses.length === 0) { console.error("Não achei as colunas de mês na linha 1."); process.exit(1); }

const rotuloMes = (iso) => {
  const [a, m] = iso.split("-");
  return `${["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][Number(m) - 1]}/${a.slice(2)}`;
};
const num = (x) => (x && typeof x.v === "number" ? Math.round(x.v * 100) / 100 : null);
const texto = (x) => (x && x.v != null ? String(x.v).trim() : "");

// ---------- lê os lançamentos ----------
const lancamentos = [];
let vazias = 0;
for (const [linha, bloco] of BLOCO_DA_LINHA) {
  const descricao = texto(cel(linha, 2));
  const parcelas = [];
  const formulas = [];
  let temCelula = false;
  for (const { col, iso } of meses) {
    const x = cel(linha, col);
    if (!x) continue;
    temCelula = true;
    if (x.f) formulas.push(`${rotuloMes(iso)}: =${x.f}`);
    const v = num(x);
    if (v) parcelas.push({ vencimento: iso, valor: v });
  }
  if (!temCelula || !descricao) { vazias++; continue; }

  const soma = Math.round(parcelas.reduce((s, p) => s + p.valor, 0) * 100) / 100;
  const colA = cel(linha, 0), colB = cel(linha, 1);
  const unidade = colB && typeof colB.v === "number" && colB.v >= 1000 && colB.v < 5000 ? colB.v : null;
  const ano = colA && typeof colA.v === "number" && colA.v > 2000 ? colA.v : null;
  const responsavel = /\bDUDU\b/i.test(descricao) ? "DUDU" : /gustavo/i.test(descricao) ? "Gustavo" : null;

  // Regra: parcelas iguais em meses seguidos = parcelado; uma só = à vista; o resto, manual.
  let regra = "manual", nParcelas = null;
  const iguais = parcelas.length >= 2 && parcelas.every((p) => Math.abs(p.valor - parcelas[0].valor) < 0.011);
  const seguidos = parcelas.every((p, i) => {
    if (i === 0) return true;
    const [a0, m0] = parcelas[i - 1].vencimento.split("-").map(Number);
    const [a1, m1] = p.vencimento.split("-").map(Number);
    return a1 * 12 + m1 - (a0 * 12 + m0) === 1;
  });
  if (parcelas.length === 1) { regra = "avista"; nParcelas = 1; }
  else if (iguais && seguidos) { regra = "parcelado"; nParcelas = parcelas.length; }

  lancamentos.push({
    linha, bloco, descricao, unidade, ano, responsavel, regra, nParcelas, parcelas,
    status: parcelas.length === 0 ? "cancelado" : "previsto",
    tipo: soma > 0 ? "entrada" : "saida",
    valorTotal: Math.abs(soma),
    primeiro: parcelas[0]?.vencimento ?? null,
    observacao: formulas.length ? `Fórmulas na planilha — ${formulas.join(" · ")}`.slice(0, 2000) : null,
    origem: `Planilha ${nomeAba} · linha ${linha}`,
  });
}

const premissas = [];
for (const [linha, tipo] of [[LINHA_FORNECEDORES, "fornecedores"], [LINHA_CLIENTES, "clientes"]]) {
  for (const { col, iso } of meses) { const v = num(cel(linha, col)); if (v != null) premissas.push({ mes: iso, tipo, valor: v }); }
}

const saldos = [];
for (const { col, iso } of meses) { const v = num(cel(LINHA_REAL, col)); if (v != null) saldos.push({ mes: iso, valor: v }); }
// Abertura do primeiro mês = saldo real no fim do mês anterior.
const abertura = num(cel(2, meses[0].col));
if (abertura != null) {
  const [a, m] = meses[0].iso.split("-").map(Number);
  const ant = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
  saldos.push({ mes: ant, valor: abertura });
}

// ---------- grava ----------
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const c = new pg.Client({
  host: "aws-1-us-east-2.pooler.supabase.com", port: 5432, user: `postgres.${ref}`,
  password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false },
});
await c.connect();
try {
  await c.query("begin");
  const { rows: ja } = await c.query(
    "select count(*)::int as n from fc_lancamentos where empresa_id = $1 and origem like 'Planilha %'", [EMPRESA]);
  if (ja[0].n > 0 && !substituir) {
    throw new Error(`Já existem ${ja[0].n} lançamentos importados de planilha. Rode com --substituir para trocar.`);
  }
  if (substituir) await c.query("delete from fc_lancamentos where empresa_id = $1 and origem like 'Planilha %'", [EMPRESA]);

  let nParc = 0;
  for (const l of lancamentos) {
    const { rows } = await c.query(
      `insert into fc_lancamentos (empresa_id, bloco_id, unidade, descricao, ano_projeto, responsavel, status, tipo, regra,
         valor_total, primeiro_vencimento, n_parcelas, intervalo_meses, observacao, origem, criado_por, atualizado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,null,null) returning id`,
      [EMPRESA, l.bloco, l.unidade, l.descricao, l.ano, l.responsavel, l.status, l.tipo, l.regra,
       l.valorTotal, l.primeiro, l.nParcelas, l.observacao, l.origem]);
    for (const p of l.parcelas) {
      await c.query("insert into fc_parcelas (lancamento_id, vencimento, valor) values ($1,$2,$3)", [rows[0].id, p.vencimento, p.valor]);
      nParc++;
    }
  }
  for (const p of premissas) {
    await c.query(
      `insert into fc_premissas (empresa_id, mes, tipo, valor, atualizado_por) values ($1,$2,$3,$4,null)
       on conflict (empresa_id, mes, tipo) do update set valor = excluded.valor, atualizado_em = now()`,
      [EMPRESA, p.mes, p.tipo, p.valor]);
  }
  for (const s of saldos) {
    await c.query(
      `insert into fc_saldos_reais (empresa_id, mes, valor, informado_por) values ($1,$2,$3,null)
       on conflict (empresa_id, mes) do update set valor = excluded.valor, informado_em = now()`,
      [EMPRESA, s.mes, s.valor]);
  }

  // ---------- confere contra a linha 203 ----------
  const { rows: fluxo } = await c.query(
    `select to_char(p.vencimento, 'YYYY-MM-01') as mes, sum(p.valor)::float as v
       from fc_parcelas p join fc_lancamentos l on l.id = p.lancamento_id
      where l.empresa_id = $1 and l.status <> 'cancelado' group by 1`, [EMPRESA]);
  const { rows: prem } = await c.query(
    "select to_char(mes, 'YYYY-MM-01') as mes, sum(valor)::float as v from fc_premissas where empresa_id = $1 group by 1", [EMPRESA]);
  const { rows: real } = await c.query(
    "select to_char(mes, 'YYYY-MM-01') as mes, valor::float as v from fc_saldos_reais where empresa_id = $1", [EMPRESA]);
  const mapa = (rows) => new Map(rows.map((r) => [r.mes, r.v]));
  const mFluxo = mapa(fluxo), mPrem = mapa(prem), mReal = mapa(real);

  const [a0, m0] = meses[0].iso.split("-").map(Number);
  const antIso = m0 === 1 ? `${a0 - 1}-12-01` : `${a0}-${String(m0 - 1).padStart(2, "0")}-01`;
  let inicial = mReal.get(antIso) ?? 0;
  let maiorDif = 0;
  const conferencia = [];
  for (const { col, iso } of meses) {
    const previsto = inicial + (mFluxo.get(iso) ?? 0) + (mPrem.get(iso) ?? 0);
    const planilha = num(cel(LINHA_PREVISTO, col)) ?? 0;
    const dif = Math.round((previsto - planilha) * 100) / 100;
    maiorDif = Math.max(maiorDif, Math.abs(dif));
    conferencia.push({ mes: rotuloMes(iso), portal: Math.round(previsto), planilha: Math.round(planilha), diferenca: dif });
    inicial = mReal.get(iso) ?? previsto;
  }

  await c.query("commit");
  console.log(`Aba "${nomeAba}" · ${meses.length} meses (${rotuloMes(meses[0].iso)} a ${rotuloMes(meses.at(-1).iso)})`);
  console.log(`Lançamentos: ${lancamentos.length} (${lancamentos.filter((l) => l.status === "cancelado").length} cancelados por estarem zerados) · parcelas: ${nParc} · linhas vazias ignoradas: ${vazias}`);
  console.log(`Regras detectadas: ${["avista", "parcelado", "manual"].map((r) => `${r} ${lancamentos.filter((l) => l.regra === r).length}`).join(" · ")}`);
  console.log(`Premissas: ${premissas.length} · saldos reais: ${saldos.length}`);
  console.log("\nSaldo previsto final — portal × planilha (linha 203):");
  console.table(conferencia);
  console.log(`Maior diferença: R$ ${maiorDif.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("Importação desfeita:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await c.end();
}
