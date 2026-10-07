// Carga de meses específicos do fluxo de caixa a partir da planilha "ENVIO".
//
//   node scripts/importar-fluxo-meses.mjs "<arquivo.xlsx>" 2026-09-01 2026-10-01 [--gravar]
//
// · só mexe nos meses informados: apaga as parcelas desses meses e grava as da
//   planilha, deixando os demais meses como estão;
// · lançamento que já existe é reaproveitado pela descrição — então fornecedor
//   vinculado, códigos no ERP e bloco atual são preservados;
// · linha nova vira lançamento novo, no bloco da seção da planilha;
// · as premissas (fornecedores e clientes) dos meses também são atualizadas.
// Só lê o arquivo; não toca no ERP.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import pg from "pg";

const req = createRequire(import.meta.url);
const XLSX = req("xlsx");

const arquivo = process.argv[2];
const meses = process.argv.slice(3).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const gravar = process.argv.includes("--gravar");
if (!arquivo || meses.length === 0) {
  console.error('Uso: node scripts/importar-fluxo-meses.mjs "<arquivo.xlsx>" 2026-09-01 2026-10-01 [--gravar]');
  process.exit(1);
}
const EMPRESA = 1;

// ---------- seções da planilha (linha → bloco) ----------
const faixa = (a, b, bloco) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, bloco]);
const BLOCO_DA_LINHA = new Map([
  [4, "pessoal"],
  ...faixa(5, 25, "estrategicos"),
  ...faixa(26, 27, "creditos_fornecedores"),
  [28, "tributos_lucro"],
  ...faixa(29, 30, "pessoal"),
  ...faixa(32, 45, "veiculos"),
  ...faixa(47, 48, "seguros"),
  ...faixa(50, 59, "ssma"),
  ...faixa(61, 141, "benfeitoria"),
  ...faixa(143, 146, "contratos"),
  ...faixa(148, 151, "financiamentos"),
  [153, "tributos_taxas"],
  [154, "fornecedores"],
  ...faixa(155, 157, "pessoal"),
  [159, "tributos_taxas"],
  ...faixa(160, 165, "tributos_vendas"),
  [166, "tributos_lucro"],
  [167, "fornecedores"],
]);
const LINHA_PREMISSA_FORNECEDORES = 3;
const LINHA_PREMISSA_CLIENTES = 168;

// ---------- planilha ----------
const wb = XLSX.readFile(arquivo, { cellDates: true });
const aba = wb.SheetNames[0];
const ws = wb.Sheets[aba];
const limite = XLSX.utils.decode_range(ws["!ref"]);
const cel = (l, c) => ws[XLSX.utils.encode_cell({ r: l - 1, c })];

// colunas de mês: cabeçalho com data na linha 1
const colunaDoMes = new Map();
for (let c = 3; c <= limite.e.c; c++) {
  const h = cel(1, c)?.v;
  if (!(h instanceof Date)) continue;
  // O cabeçalho vem como meia-noite UTC: lido no fuso local viraria o dia 31 do
  // mês anterior e a carga pegaria a coluna errada.
  const mes = `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, "0")}-01`;
  if (!colunaDoMes.has(mes)) colunaDoMes.set(mes, c);
}
for (const m of meses) if (!colunaDoMes.has(m)) { console.error(`A planilha não tem a coluna de ${m}. Tem: ${[...colunaDoMes.keys()].join(", ")}`); process.exit(1); }

const chave = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

const linhas = [];
for (let l = 2; l <= limite.e.r + 1; l++) {
  const bloco = BLOCO_DA_LINHA.get(l);
  if (!bloco) continue;
  const descricao = String(cel(l, 2)?.v ?? "").trim();
  if (!descricao) continue;
  const valores = new Map();
  for (const m of meses) {
    const v = numero(cel(l, colunaDoMes.get(m))?.v);
    if (v) valores.set(m, v);
  }
  const unidade = Number(cel(l, 1)?.v);
  const ano = Number(cel(l, 0)?.v);
  linhas.push({
    linha: l, bloco, descricao, chave: chave(descricao),
    unidade: Number.isFinite(unidade) && unidade > 0 ? unidade : null,
    ano: Number.isFinite(ano) && ano > 2000 ? ano : null,
    valores,
  });
}
const premissas = [];
for (const [linha, tipo] of [[LINHA_PREMISSA_FORNECEDORES, "fornecedores"], [LINHA_PREMISSA_CLIENTES, "clientes"]]) {
  for (const m of meses) {
    const v = numero(cel(linha, colunaDoMes.get(m))?.v);
    if (v) premissas.push({ mes: m, tipo, valor: v });
  }
}

// ---------- banco ----------
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const c = new pg.Client({ host: "aws-1-us-east-2.pooler.supabase.com", port: 5432, user: `postgres.${ref}`, password: env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await c.connect();

const existentes = (await c.query("select id, bloco_id, descricao, unidade, cd_pessoa from fc_lancamentos where empresa_id = $1", [EMPRESA])).rows;
const porChave = new Map();
for (const l of existentes) {
  const k = chave(l.descricao);
  if (!porChave.has(k)) porChave.set(k, l);
}

const casadas = linhas.filter((l) => porChave.has(l.chave));
const novas = linhas.filter((l) => !porChave.has(l.chave) && l.valores.size > 0);
const comValor = linhas.filter((l) => l.valores.size > 0);

console.log(`Planilha: ${aba} · ${arquivo}`);
console.log(`Meses: ${meses.join(", ")}`);
console.log(`Linhas com valor nos meses: ${comValor.length} (${casadas.filter((l) => l.valores.size).length} já existem, ${novas.length} novas)`);
for (const m of meses) {
  const soma = comValor.reduce((s, l) => s + (l.valores.get(m) ?? 0), 0);
  const prem = premissas.filter((p) => p.mes === m);
  console.log(`  ${m}: lançamentos ${soma.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} · premissas ${prem.map((p) => `${p.tipo} ${p.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`).join(" · ")}`);
}
if (novas.length) {
  console.log("\nLinhas novas (viram lançamento):");
  for (const l of novas) console.log(`  L${l.linha} [${l.bloco}]${l.unidade ? ` un ${l.unidade}` : ""} ${l.descricao}`);
}
const vinculadas = casadas.filter((l) => porChave.get(l.chave).cd_pessoa != null);
console.log(`\nLinhas já com fornecedor vinculado que serão preservadas: ${vinculadas.length}`);

if (!gravar) { console.log("\n(simulação — nada foi gravado; rode com --gravar)"); await c.end(); process.exit(0); }

await c.query("begin");
// 1) limpa os meses escolhidos
const apagadas = (await c.query(
  `delete from fc_parcelas p using fc_lancamentos l
    where l.id = p.lancamento_id and l.empresa_id = $1 and p.vencimento = any($2::date[])`, [EMPRESA, meses])).rowCount;
const apagadasPrem = (await c.query("delete from fc_premissas where empresa_id = $1 and mes = any($2::date[])", [EMPRESA, meses])).rowCount;

// 2) grava as linhas da planilha
let criados = 0, parcelas = 0;
for (const l of linhas) {
  if (l.valores.size === 0) continue;
  let alvo = porChave.get(l.chave);
  if (!alvo) {
    const { rows } = await c.query(
      `insert into fc_lancamentos (empresa_id, bloco_id, unidade, descricao, ano_projeto, status, tipo, regra, origem)
       values ($1, $2, $3, $4, $5, 'previsto', $6, 'manual', $7) returning id`,
      [EMPRESA, l.bloco, l.unidade, l.descricao, l.ano,
       [...l.valores.values()].reduce((s, v) => s + v, 0) >= 0 ? "entrada" : "saida", `Planilha ${aba} · linha ${l.linha}`]);
    alvo = { id: rows[0].id };
    porChave.set(l.chave, alvo);
    criados += 1;
  }
  for (const [mes, valor] of l.valores) {
    await c.query("insert into fc_parcelas (lancamento_id, vencimento, valor, ajustada) values ($1, $2, $3, true)", [alvo.id, mes, valor]);
    parcelas += 1;
  }
}
for (const p of premissas) {
  await c.query("insert into fc_premissas (empresa_id, mes, tipo, valor) values ($1, $2, $3, $4)", [EMPRESA, p.mes, p.tipo, p.valor]);
}
// 3) mantém valor_total e nº de parcelas coerentes com o que ficou
await c.query(`update fc_lancamentos l set
     valor_total = abs(x.soma), n_parcelas = x.qtd, primeiro_vencimento = x.inicio,
     tipo = case when x.soma >= 0 then 'entrada' else 'saida' end
   from (select lancamento_id, sum(valor) soma, count(*) qtd, min(vencimento) inicio
           from fc_parcelas group by 1) x
  where x.lancamento_id = l.id and l.empresa_id = $1`, [EMPRESA]);
await c.query("commit");

console.log(`\nGravado: ${apagadas} parcela(s) e ${apagadasPrem} premissa(s) desses meses apagadas; ${parcelas} parcela(s) e ${premissas.length} premissa(s) gravadas; ${criados} lançamento(s) novo(s).`);
const resumo = await c.query(
  `select b.nome bloco, sum(p.valor) filter (where p.vencimento = $2)::numeric(16,2) mes1,
          sum(p.valor) filter (where p.vencimento = $3)::numeric(16,2) mes2
     from fc_parcelas p join fc_lancamentos l on l.id = p.lancamento_id join fc_blocos b on b.id = l.bloco_id
    where l.empresa_id = $1 and p.vencimento = any($4::date[]) group by 1 order by 1`,
  [EMPRESA, meses[0], meses[1] ?? meses[0], meses]);
console.table(resumo.rows);
await c.end();
