// Enfileira um pedido de sincronização (para o Agendador de Tarefas).
//   node scripts/sync-enfileirar.mjs incremental
//   node scripts/sync-enfileirar.mjs full_ano 2026
//   node scripts/sync-enfileirar.mjs full_hist
import { carregarEnv, criarSupabase } from "./sync-core.mjs";

const tipo = process.argv[2] ?? "incremental";
const arg3 = process.argv[3];
const params = tipo === "full_ano" && arg3 ? { ano: Number(arg3) } : null;

const supabase = criarSupabase(carregarEnv());
const { data, error } = await supabase.from("sync_pedidos")
  .insert({ tipo, params, origem: "agendado" }).select("id").single();
if (error) { console.error(`[enfileirar] erro: ${error.message}`); process.exit(1); }
console.log(`[enfileirar] pedido #${data.id} (${tipo}) criado.`);
process.exit(0);
