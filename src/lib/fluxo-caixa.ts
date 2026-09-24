// Fluxo de Caixa — tipos, geração de parcelas e cálculo do saldo.
// Espelha a migração 025. Datas trafegam como "YYYY-MM-DD"; meses como "YYYY-MM-01".
// Sinal como na planilha: entrada positiva, saída negativa.

export type Status = "previsto" | "aprovado" | "contratado" | "realizado" | "cancelado";
export type Regra = "avista" | "parcelado" | "entrada_parcelas" | "manual";
export type Tipo = "entrada" | "saida";

export const STATUS: { id: Status; rotulo: string }[] = [
  { id: "previsto", rotulo: "Previsto" },
  { id: "aprovado", rotulo: "Aprovado" },
  { id: "contratado", rotulo: "Contratado" },
  { id: "realizado", rotulo: "Realizado" },
  { id: "cancelado", rotulo: "Cancelado" },
];

export const REGRAS: { id: Regra; rotulo: string }[] = [
  { id: "avista", rotulo: "À vista" },
  { id: "parcelado", rotulo: "Parcelado" },
  { id: "entrada_parcelas", rotulo: "Entrada + parcelas" },
  { id: "manual", rotulo: "Manual" },
];

export interface Bloco { id: string; nome: string; ordem: number; pai_id?: string | null }

export interface Parcela { vencimento: string; valor: number; ajustada?: boolean }

export interface Lancamento {
  id: string;
  empresa_id: number;
  bloco_id: string;
  unidade: number | null;
  descricao: string;
  ano_projeto: number | null;
  responsavel: string | null;
  status: Status;
  tipo: Tipo;
  regra: Regra;
  valor_total: number | null;
  primeiro_vencimento: string | null;
  n_parcelas: number | null;
  intervalo_meses: number;
  entrada_pct: number | null;
  codigos_erp: string | null;
  observacao: string | null;
  origem: string | null;
  atualizado_em: string;
  parcelas: Parcela[];
}

export interface Premissa { mes: string; tipo: "clientes" | "fornecedores"; valor: number }
export interface SaldoReal { mes: string; valor: number }

/** Blocos cujo movimento vem de uma premissa mensal (e não só de itens). */
export const PREMISSA_DO_BLOCO: Record<string, { tipo: Premissa["tipo"]; rotulo: string } | undefined> = {
  recebimentos: { tipo: "clientes", rotulo: "Clientes (média)" },
  fornecedores: { tipo: "fornecedores", rotulo: "Fornecedores (média)" },
};

// ---------- datas ----------
const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function mesDe(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

/** Soma meses mantendo o dia (limitado ao fim do mês: 31/01 + 1 = 28/02). */
export function somarMeses(data: string, n: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12), mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

export function listarMeses(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let m = mesDe(de); m <= mesDe(ate); m = somarMeses(m, 1)) out.push(m);
  return out;
}

export function rotuloMes(mes: string): string {
  const [a, m] = mes.split("-");
  return `${NOMES_MES[Number(m) - 1]}/${a.slice(2)}`;
}

export function rotuloData(data: string): string {
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}`;
}

// ---------- valores ----------
const centavos = (v: number) => Math.round(v * 100) / 100;

export function formatReais(v: number, casas = 0): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Grade em R$ mil (o que arredondaria para zero sai como "~0"). */
export function formatGrade(v: number, milhares: boolean): string {
  if (!milhares) return formatReais(v);
  const m = v / 1000;
  if (v !== 0 && Math.abs(m) < 0.5) return "~0";
  return formatReais(m);
}

/** Aceita "22.700.000", "22700000", "-11.000.000,50". Vazio = null. */
export function lerValor(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, "").replace(/R\$/i, "");
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/\.(?=\d{3}(\D|$))/g, "");
  const v = Number(normal);
  return Number.isFinite(v) ? centavos(v) : null;
}

// ---------- parcelas ----------
export interface RegraParcelas {
  regra: Exclude<Regra, "manual">;
  tipo: Tipo;
  valorTotal: number;
  primeiroVencimento: string;
  nParcelas: number;
  intervaloMeses: number;
  entradaPct: number;
}

/**
 * Distribui o total pela regra. Parcelas iguais, e a última absorve a sobra dos
 * centavos para a soma fechar exatamente no total.
 */
export function gerarParcelas(r: RegraParcelas): Parcela[] {
  const sinal = r.tipo === "saida" ? -1 : 1;
  const total = Math.abs(r.valorTotal);
  if (!(total > 0) || !r.primeiroVencimento) return [];

  const dividir = (valor: number, n: number, inicio: string): Parcela[] => {
    const qtd = Math.max(1, Math.floor(n));
    const base = centavos(valor / qtd);
    return Array.from({ length: qtd }, (_, i) => ({
      vencimento: somarMeses(inicio, i * r.intervaloMeses),
      valor: sinal * (i === qtd - 1 ? centavos(valor - base * (qtd - 1)) : base),
    }));
  };

  if (r.regra === "avista") return [{ vencimento: r.primeiroVencimento, valor: sinal * total }];
  if (r.regra === "parcelado") return dividir(total, r.nParcelas, r.primeiroVencimento);

  const entrada = centavos(total * (Math.min(100, Math.max(0, r.entradaPct)) / 100));
  const resto = dividir(total - entrada, r.nParcelas, somarMeses(r.primeiroVencimento, r.intervaloMeses));
  return entrada > 0 ? [{ vencimento: r.primeiroVencimento, valor: sinal * entrada }, ...resto] : resto;
}

// ---------- saldo ----------
export interface SaldoMes { inicial: number; inicialReal: boolean; previsto: number; real: number | null; diferenca: number | null }

/**
 * A regra da planilha: o saldo inicial de um mês é o REAL do mês anterior, se
 * informado; senão, o PREVISTO do anterior. O encadeamento começa no primeiro
 * mês com dado, mesmo que ele esteja antes do período exibido.
 */
export function calcularSaldos(visiveis: string[], fluxo: Map<string, number>, reais: Map<string, number>): Map<string, SaldoMes> {
  const resultado = new Map<string, SaldoMes>();
  if (visiveis.length === 0) return resultado;
  const candidatos = [visiveis[0], ...fluxo.keys(), ...[...reais.keys()].map((m) => somarMeses(m, 1))];
  const inicio = candidatos.sort()[0];
  const fim = visiveis[visiveis.length - 1];

  const anteriorAoInicio = somarMeses(inicio, -1);
  let inicial = reais.get(anteriorAoInicio) ?? 0;
  let inicialReal = reais.has(anteriorAoInicio);
  for (const m of listarMeses(inicio, fim)) {
    const previsto = centavos(inicial + (fluxo.get(m) ?? 0));
    const real = reais.get(m) ?? null;
    resultado.set(m, { inicial, inicialReal, previsto, real, diferenca: real == null ? null : centavos(real - previsto) });
    inicial = real ?? previsto;
    inicialReal = real != null;
  }
  return resultado;
}
