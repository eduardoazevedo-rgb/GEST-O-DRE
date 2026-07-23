import type { DreResposta } from "@/lib/types";

// Cache compartilhado do /api/dre entre as abas (DRE, Executivo, Análise de
// custos). Evita rebuscar o mesmo ano ao trocar de tela e deduplica requisições
// concorrentes. Estratégia SWR: devolve o cache na hora (pinta a tela) e o
// consumidor revalida em segundo plano — por isso um valor levemente antigo é
// seguro, some assim que o fetch de fundo retorna.
//
// Além do Map em memória (rápido), espelhamos na sessionStorage para que um
// RELOAD ou reabrir a aba no mesmo computador pinte instantaneamente, sem
// esperar a rede. sessionStorage (e não localStorage) porque limpa sozinha ao
// fechar a aba — não deixa dado financeiro parado no navegador.
const STORAGE_KEY = "dre-cache-v1";
const TTL_MS = 12 * 60 * 60 * 1000; // hidrata só o que tem < 12h (higiene)

const cache = new Map<number, DreResposta>();
const inflight = new Map<number, Promise<DreResposta>>();

type Entrada = { ts: number; data: DreResposta };

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // modo privado/bloqueado
  }
}

let hidratado = false;
function garantirHidratado() {
  if (hidratado) return;
  hidratado = true;
  const s = store();
  if (!s) return;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, Entrada>;
    const agora = Date.now();
    for (const [ano, e] of Object.entries(obj)) {
      if (e && agora - e.ts < TTL_MS) cache.set(Number(ano), e.data);
    }
  } catch {
    /* json inválido — ignora */
  }
}

function persistir(ano: number, data: DreResposta) {
  const s = store();
  if (!s) return;
  try {
    const raw = s.getItem(STORAGE_KEY);
    const obj = (raw ? JSON.parse(raw) : {}) as Record<string, Entrada>;
    obj[ano] = { ts: Date.now(), data };
    s.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* cota estourada/serialização — o Map em memória continua valendo */
  }
}

export function dreEmCache(ano: number): DreResposta | undefined {
  garantirHidratado();
  return cache.get(ano);
}

export function buscarDre(ano: number): Promise<DreResposta> {
  garantirHidratado();
  const existente = inflight.get(ano);
  if (existente) return existente;
  const p = fetch(`/api/dre?ano=${ano}`)
    .then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erro ao carregar DRE");
      cache.set(ano, j as DreResposta);
      persistir(ano, j as DreResposta);
      inflight.delete(ano);
      return j as DreResposta;
    })
    .catch((e) => {
      inflight.delete(ano);
      throw e;
    });
  inflight.set(ano, p);
  return p;
}

/** Limpa o cache (ex.: após uma sincronização, para forçar dados novos). */
export function invalidarDre() {
  cache.clear();
  const s = store();
  if (s) {
    try {
      s.removeItem(STORAGE_KEY);
    } catch {
      /* ignora */
    }
  }
}
