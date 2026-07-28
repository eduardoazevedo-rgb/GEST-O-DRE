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
const STORAGE_KEY = "dre-cache-v2";
const TTL_MS = 12 * 60 * 60 * 1000; // hidrata só o que tem < 12h (higiene)

// Chave = ano + unidade (null = empresa inteira), porque o mesmo ano tem uma
// resposta diferente para cada filtro de unidade.
const chave = (ano: number, unidade?: number | null) => (unidade == null ? `${ano}` : `${ano}|u${unidade}`);

const cache = new Map<string, DreResposta>();
const inflight = new Map<string, Promise<DreResposta>>();

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
    for (const [k, e] of Object.entries(obj)) {
      if (e && agora - e.ts < TTL_MS) cache.set(k, e.data);
    }
  } catch {
    /* json inválido — ignora */
  }
}

function persistir(k: string, data: DreResposta) {
  const s = store();
  if (!s) return;
  try {
    const raw = s.getItem(STORAGE_KEY);
    const obj = (raw ? JSON.parse(raw) : {}) as Record<string, Entrada>;
    obj[k] = { ts: Date.now(), data };
    s.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* cota estourada/serialização — o Map em memória continua valendo */
  }
}

export function dreEmCache(ano: number, unidade?: number | null): DreResposta | undefined {
  garantirHidratado();
  return cache.get(chave(ano, unidade));
}

export function buscarDre(ano: number, unidade?: number | null): Promise<DreResposta> {
  garantirHidratado();
  const k = chave(ano, unidade);
  const existente = inflight.get(k);
  if (existente) return existente;
  const url = unidade == null ? `/api/dre?ano=${ano}` : `/api/dre?ano=${ano}&unidade=${unidade}`;
  const p = fetch(url)
    .then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erro ao carregar DRE");
      cache.set(k, j as DreResposta);
      persistir(k, j as DreResposta);
      inflight.delete(k);
      return j as DreResposta;
    })
    .catch((e) => {
      inflight.delete(k);
      throw e;
    });
  inflight.set(k, p);
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
