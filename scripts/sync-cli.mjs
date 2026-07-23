// Execução DIRETA de sincronização (sem passar pela fila). Uso manual/setup:
//   node scripts/sync-cli.mjs incremental
//   node scripts/sync-cli.mjs full_ano 2026
//   node scripts/sync-cli.mjs full_hist
import {
  carregarEnv, criarSupabase, criarFirebird, excluidas,
  claimLock, releaseLock, executarIncremental, executarFull,
} from "./sync-core.mjs";

const tipo = process.argv[2] ?? "incremental";
const arg3 = process.argv[3];
const anoAtual = new Date().getFullYear();

const env = carregarEnv();
const supabase = criarSupabase(env);

if (!(await claimLock(supabase))) { console.log("[cli] outra sync em execução — saindo."); process.exit(0); }
const fb = criarFirebird(env);
const exc = excluidas(env);
const t0 = Date.now();
try {
  let res;
  if (tipo === "incremental") res = await executarIncremental(supabase, fb, exc);
  else if (tipo === "full_ano") res = await executarFull(supabase, fb, exc, Number(arg3 ?? anoAtual));
  else if (tipo === "full_hist") {
    let linhas = 0; const anos = [anoAtual, anoAtual - 1, anoAtual - 2];
    for (const a of anos) linhas += (await executarFull(supabase, fb, exc, a)).linhas;
    res = { linhas, meses: anos.length * 12 };
  } else { throw new Error(`Tipo inválido: ${tipo}`); }
  console.log(`[cli] ${tipo} OK: ${res.meses} mês(es), ${res.linhas} linha(s) em ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
} catch (e) {
  console.error(`[cli] ERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await releaseLock(supabase);
}
process.exit(process.exitCode ?? 0);
