// Atualiza só o resumo de títulos do ERP usado no cruzamento do Fluxo de Caixa.
// A sincronização agendada já faz isso no fim; este script é para rodar na mão.
//   node scripts/sync-fluxo-erp.mjs
import { carregarEnv, criarFirebird, sincronizarTitulosFluxo } from "./sync-core.mjs";

const env = carregarEnv();
const inicio = Date.now();
try {
  const n = await sincronizarTitulosFluxo(env, criarFirebird(env));
  console.log(`[fluxo × ERP] ${n} linha(s) de resumo gravadas em ${((Date.now() - inicio) / 1000).toFixed(1)}s.`);
} catch (e) {
  console.error(`[fluxo × ERP] ERRO: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
