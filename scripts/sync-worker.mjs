// Vigia local: processa a fila sync_pedidos (botão "Atualizar agora" e agendados).
// Roda nesta máquina (alcança o Firebird). Agende no Agendador de Tarefas do
// Windows a cada ~1 min. Um lock impede execuções simultâneas.
//   npm run sync:worker
import {
  carregarEnv, criarSupabase, criarFirebird, excluidas,
  claimLock, releaseLock, executarIncremental, executarFull,
} from "./sync-core.mjs";

const env = carregarEnv();
const supabase = criarSupabase(env);

// Só trava (e sinaliza "atualizando") se houver pedido pendente.
const { data: pend0 } = await supabase.from("sync_pedidos").select("id").eq("status", "pendente").limit(1);
if (!pend0 || pend0.length === 0) { process.exit(0); }

const ok = await claimLock(supabase);
if (!ok) { console.log("[worker] outra execução em andamento — saindo."); process.exit(0); }

const fb = criarFirebird(env);
const exc = excluidas(env);
const anoAtual = new Date().getFullYear();

async function rodar(pedido) {
  const t = pedido.tipo;
  if (t === "incremental") return executarIncremental(supabase, fb, exc);
  if (t === "full_ano") return executarFull(supabase, fb, exc, Number(pedido.params?.ano ?? anoAtual));
  if (t === "full_hist") {
    const anos = pedido.params?.anos ?? [anoAtual, anoAtual - 1, anoAtual - 2];
    let linhas = 0;
    for (const a of anos) linhas += (await executarFull(supabase, fb, exc, a)).linhas;
    return { linhas, meses: anos.length * 12 };
  }
  throw new Error(`Tipo de pedido desconhecido: ${t}`);
}

try {
  let processados = 0;
  for (;;) {
    const { data: pend } = await supabase.from("sync_pedidos")
      .select("*").eq("status", "pendente").order("criado_em", { ascending: true }).limit(1);
    const pedido = pend?.[0];
    if (!pedido) break;

    await supabase.from("sync_pedidos")
      .update({ status: "executando", iniciado_em: new Date().toISOString() }).eq("id", pedido.id);
    console.log(`[worker] pedido #${pedido.id} (${pedido.tipo}, ${pedido.origem})…`);
    const t0 = Date.now();
    try {
      const res = await rodar(pedido);
      await supabase.from("sync_pedidos").update({
        status: "ok", linhas: res.linhas, finalizado_em: new Date().toISOString(),
        mensagem: `${res.meses} mês(es), ${res.linhas} linha(s) em ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      }).eq("id", pedido.id);
      console.log(`[worker] pedido #${pedido.id} OK (${res.linhas} linhas).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("sync_pedidos").update({
        status: "erro", finalizado_em: new Date().toISOString(), mensagem: msg,
      }).eq("id", pedido.id);
      console.error(`[worker] pedido #${pedido.id} ERRO: ${msg}`);
    }
    processados++;
  }
  if (processados === 0) console.log("[worker] nenhum pedido pendente.");
} finally {
  await releaseLock(supabase);
}
process.exit(0);
