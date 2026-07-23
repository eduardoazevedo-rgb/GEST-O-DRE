import type { DreResposta, DreLinha } from "@/lib/types";
import { MESES_CURTO } from "@/lib/labels";

export type Periodo = { modo: "mes" | "ytd"; mes: number }; // mes: 0..11

/** Valor de um array mensal no período: mês pontual ou YTD (soma até o mês). */
export function valorPeriodo(arr: number[], p: Periodo): number {
  if (p.modo === "mes") return arr[p.mes] ?? 0;
  return arr.slice(0, p.mes + 1).reduce((a, b) => a + b, 0);
}

function linha(dados: DreResposta, codigo: string): DreLinha | undefined {
  return dados.linhas.find((l) => l.codigo === codigo);
}

type Campo = "realizado" | "planejado";

function total(dados: DreResposta, codigo: string, campo: Campo, p: Periodo): number {
  const l = linha(dados, codigo);
  return l ? valorPeriodo(l[campo], p) : 0;
}

function somaCodigos(dados: DreResposta, codigos: string[], campo: Campo, p: Periodo): number {
  return codigos.reduce((a, c) => a + total(dados, c, campo, p), 0);
}

/** Soma das linhas N2 (= Resultado líquido, idêntico à linha RESULTADO da tela DRE). */
function somaN2(dados: DreResposta, campo: Campo, p: Periodo): number {
  return dados.linhas
    .filter((l) => l.nivel === 2)
    .reduce((a, l) => a + valorPeriodo(l[campo], p), 0);
}

// Contas de Depreciação/Amortização readicionadas no EBITDA (grupos N4 inteiros).
const GRUPOS_DA = ["3.3.3.15", "3.4.1.17", "3.4.2.18"];

/**
 * Estrutura da DRE (lógica original — reconcilia à vírgula com a tela DRE):
 *  - Custo das vendas = 3.3 inteiro (inclui a absorção 3.3.3 e os ajustes 3.3.4).
 *  - Financeiro = 3.7 inteiro (inclui os créditos de fornecedores 3.7.1.02).
 *  - EBITDA = Resultado operacional + D&A (3.3.3.15 + 3.4.1.17 + 3.4.2.18; contas
 *    negativas, somar de volta = subtrair).
 *  - Resultado líquido = soma dos N2 = linha RESULTADO da tela DRE.
 *  Sinais já vêm embutidos (custos/despesas/D&A negativos) — subtotais são somas simples.
 */
export interface BlocosDre {
  receita: number;       // 3.1
  custos: number;        // 3.3 (inteiro)
  lucroBruto: number;    // receita + custos
  sgae: number;          // 3.4
  outrasOp: number;      // 3.5
  da: number;            // 3.3.3.15 + 3.4.1.17 + 3.4.2.18 (negativo)
  ebit: number;          // receita + custos + sgae + outrasOp
  ebitda: number;        // ebit − da
  financeiro: number;    // 3.7 (inteiro)
  ir: number;            // 3.9
  lucroLiquido: number;  // soma N2
}

export function blocosDre(dados: DreResposta, campo: Campo, p: Periodo): BlocosDre {
  const receita = total(dados, "3.1", campo, p);
  const custos = total(dados, "3.3", campo, p);
  const sgae = total(dados, "3.4", campo, p);
  const outrasOp = total(dados, "3.5", campo, p);
  const financeiro = total(dados, "3.7", campo, p);
  const ir = total(dados, "3.9", campo, p);
  const da = somaCodigos(dados, GRUPOS_DA, campo, p);
  const ebit = receita + custos + sgae + outrasOp;
  return {
    receita, custos, lucroBruto: receita + custos, sgae, outrasOp,
    da, ebit, ebitda: ebit - da, financeiro, ir,
    lucroLiquido: somaN2(dados, campo, p),
  };
}

function pct(a: number, b: number): number | null {
  if (b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

export interface KpiTriplo {
  chave: string;
  titulo: string;
  ehPercentual?: boolean;
  realizado: number;
  planejado: number;
  deltaPlanAbs: number;
  deltaPlanPct: number | null;
  favoravel: boolean;
  margem?: number | null; // margem %RL do realizado (subtítulo do card)
}

function kpi(chave: string, titulo: string, r: number, pl: number, ehPercentual = false): KpiTriplo {
  return {
    chave, titulo, ehPercentual,
    realizado: r, planejado: pl,
    deltaPlanAbs: r - pl, deltaPlanPct: pct(r, pl),
    favoravel: r - pl >= 0,
  };
}

/**
 * KPIs de topo — progressão da DRE (Realizado × Orçado): Receita líquida,
 * Lucro bruto e Resultado líquido. Cada um com a margem %RL do realizado.
 * Todos saem do mesmo roll-up da tela DRE (sem métricas derivadas como EBITDA).
 */
export function kpisTopo(dados: DreResposta, _anterior: DreResposta | null, p: Periodo): KpiTriplo[] {
  const r = blocosDre(dados, "realizado", p);
  const o = blocosDre(dados, "planejado", p);
  const marg = (v: number) => (r.receita !== 0 ? (v / r.receita) * 100 : null);
  return [
    kpi("receita", "Receita líquida", r.receita, o.receita),
    { ...kpi("bruto", "Lucro bruto", r.lucroBruto, o.lucroBruto), margem: marg(r.lucroBruto) },
    { ...kpi("ll", "Resultado líquido", r.lucroLiquido, o.lucroLiquido), margem: marg(r.lucroLiquido) },
  ];
}

export interface LinhaDre {
  chave: string;
  rotulo: string;
  subtotal?: boolean;
  realizado: number;
  planejado: number;
  deltaAbs: number;
  deltaPct: number | null;
  favoravel: boolean;
  vertReal: number | null;
}

/** Linhas da DRE (layout v1) com variação e análise vertical (%RL). */
export function linhasDre(dados: DreResposta, _anterior: DreResposta | null, p: Periodo): LinhaDre[] {
  const r = blocosDre(dados, "realizado", p);
  const o = blocosDre(dados, "planejado", p);
  const vert = (v: number, base: number): number | null => (base !== 0 ? (v / base) * 100 : null);

  const mk = (chave: string, rotulo: string, sel: (b: BlocosDre) => number, subtotal = false): LinhaDre => {
    const real = sel(r), plan = sel(o);
    return {
      chave, rotulo, subtotal,
      realizado: real, planejado: plan,
      deltaAbs: real - plan, deltaPct: pct(real, plan),
      favoravel: real - plan >= 0,
      vertReal: vert(real, r.receita),
    };
  };

  return [
    mk("receita", "Receita líquida", (b) => b.receita),
    mk("custos", "(−) Custo das vendas", (b) => b.custos),
    mk("bruto", "= Lucro bruto", (b) => b.lucroBruto, true),
    mk("sgae", "(−) Despesas SG&A", (b) => b.sgae),
    mk("outras", "(±) Outras op.", (b) => b.outrasOp),
    mk("ebitda", "= EBITDA", (b) => b.ebitda, true),
    mk("da", "(+) Deprec. e amortização", (b) => -b.da),
    mk("ebit", "= EBIT", (b) => b.ebit, true),
    mk("fin", "(±) Result. financeiro", (b) => b.financeiro),
    mk("ir", "(−) IR e CS", (b) => b.ir),
    mk("ll", "= Resultado líquido", (b) => b.lucroLiquido, true),
  ];
}

export interface MargemNaturezaYoY {
  chave: string;
  titulo: string;
  // Linhas do mini-DRE (período selecionado) — ano atual × ano anterior.
  brutaAtual: number;   brutaAnt: number;      // receita bruta (+)
  devolAtual: number;   devolAnt: number;      // devoluções (−)
  impostosAtual: number; impostosAnt: number;  // impostos (−)
  receitaLiqAtual: number; receitaLiqAnt: number;
  custoAtual: number;   custoAnt: number;      // custo direto (−)
  margemAtual: number;  margemAnt: number;     // receita líq + custo
  margemPctAtual: number | null; margemPctAnt: number | null;   // margem / receita líq
  custoRecAtual: number | null;  custoRecAnt: number | null;    // |custo| / receita líq
  deltaReceitaPct: number | null;  // YoY receita líquida
  deltaCustoPct: number | null;    // YoY custo
  deltaMargemPct: number | null;   // YoY margem
  custoAcompanhou: boolean;        // custo/receita não subiu vs ano anterior
  // 12 meses (ano atual) — receita já com sinal (devoluções/impostos negativos).
  serie: { mes: string; bruta: number; devol: number; impostos: number; receita: number; custo: number; custoRec: number | null }[];
}

// Códigos de custo direto por natureza (decisão do usuário: sem absorção/acertos).
const CUSTO_DIRETO: Record<"merc" | "serv", string> = { merc: "3.3.1", serv: "3.3.2" };

/** Array mensal (12) de um nó exato da DRE (já roll-up), ou zeros. */
function nodeArr(dados: DreResposta, codigo: string, campo: Campo): number[] {
  const l = linha(dados, codigo);
  return l ? l[campo] : Array(12).fill(0);
}

/** Soma elementwise (12 meses) das linhas N4 de um grupo 3.1.x cujo nome casa a natureza. */
function grupoReceitaArr(dados: DreResposta, prefixo: string, palavra: string, campo: Campo): number[] {
  const acc = Array(12).fill(0) as number[];
  for (const l of dados.linhas) {
    if (l.nivel === 4 && l.codigo.startsWith(prefixo) && l.nome.toUpperCase().includes(palavra)) {
      for (let m = 0; m < 12; m++) acc[m] += l[campo][m] ?? 0;
    }
  }
  return acc;
}

/**
 * Margem de contribuição por natureza (Mercadorias × Serviços) — ano atual × ano
 * anterior (YoY). Receita líquida = bruta (3.1.1) − devoluções (3.1.2) − impostos
 * (3.1.3), classificadas pelo nome (MERCADORIA/SERVICO); aluguéis ficam fora.
 * Custo = direto por natureza (3.3.1 merc / 3.3.2 serv), sem absorção nem acertos.
 * O foco é a coerência receita×custo: se a receita cai, o custo deveria cair junto —
 * `custoAcompanhou` sinaliza se a razão custo/receita se manteve (ou melhorou).
 */
export function margensNaturezaYoY(
  atual: DreResposta, anterior: DreResposta | null, p: Periodo
): MargemNaturezaYoY[] {
  const naturezas: { chave: "merc" | "serv"; titulo: string; palavra: string }[] = [
    { chave: "merc", titulo: "Mercadorias", palavra: "MERCADORIA" },
    { chave: "serv", titulo: "Serviços", palavra: "SERVICO" },
  ];
  const soma12 = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);

  const out: MargemNaturezaYoY[] = [];
  for (const n of naturezas) {
    const brutaA = grupoReceitaArr(atual, "3.1.1.", n.palavra, "realizado");
    const devolA = grupoReceitaArr(atual, "3.1.2.", n.palavra, "realizado");
    const impA = grupoReceitaArr(atual, "3.1.3.", n.palavra, "realizado");
    const custoA = nodeArr(atual, CUSTO_DIRETO[n.chave], "realizado");
    const recLiqA = soma12(soma12(brutaA, devolA), impA);

    const zeros = Array(12).fill(0) as number[];
    const brutaP = anterior ? grupoReceitaArr(anterior, "3.1.1.", n.palavra, "realizado") : zeros;
    const devolP = anterior ? grupoReceitaArr(anterior, "3.1.2.", n.palavra, "realizado") : zeros;
    const impP = anterior ? grupoReceitaArr(anterior, "3.1.3.", n.palavra, "realizado") : zeros;
    const custoP = anterior ? nodeArr(anterior, CUSTO_DIRETO[n.chave], "realizado") : zeros;
    const recLiqP = soma12(soma12(brutaP, devolP), impP);

    const v = (arr: number[]) => valorPeriodo(arr, p);
    const brutaAtual = v(brutaA), devolAtual = v(devolA), impostosAtual = v(impA);
    const receitaLiqAtual = v(recLiqA), custoAtual = v(custoA);
    const brutaAnt = v(brutaP), devolAnt = v(devolP), impostosAnt = v(impP);
    const receitaLiqAnt = v(recLiqP), custoAnt = v(custoP);
    if (receitaLiqAtual === 0 && receitaLiqAnt === 0) continue;

    const margemAtual = receitaLiqAtual + custoAtual;
    const margemAnt = receitaLiqAnt + custoAnt;
    const margemPctAtual = receitaLiqAtual !== 0 ? (margemAtual / receitaLiqAtual) * 100 : null;
    const margemPctAnt = receitaLiqAnt !== 0 ? (margemAnt / receitaLiqAnt) * 100 : null;
    const custoRecAtual = receitaLiqAtual !== 0 ? (-custoAtual / receitaLiqAtual) * 100 : null;
    const custoRecAnt = receitaLiqAnt !== 0 ? (-custoAnt / receitaLiqAnt) * 100 : null;

    const serie = MESES_CURTO.map((mes, m) => {
      const receita = recLiqA[m];
      const custo = -custoA[m]; // positivo para o gráfico
      return { mes, bruta: brutaA[m], devol: devolA[m], impostos: impA[m], receita, custo, custoRec: receita !== 0 ? (custo / receita) * 100 : null };
    });

    out.push({
      chave: n.chave, titulo: n.titulo,
      brutaAtual, brutaAnt, devolAtual, devolAnt, impostosAtual, impostosAnt,
      receitaLiqAtual, receitaLiqAnt, custoAtual, custoAnt, margemAtual, margemAnt,
      margemPctAtual, margemPctAnt, custoRecAtual, custoRecAnt,
      deltaReceitaPct: pct(receitaLiqAtual, receitaLiqAnt),
      deltaCustoPct: pct(-custoAtual, -custoAnt),
      deltaMargemPct: pct(margemAtual, margemAnt),
      custoAcompanhou: (custoRecAtual ?? 0) <= (custoRecAnt ?? 0) + 0.05,
      serie,
    });
  }
  return out;
}

export interface PassoPonte {
  chave: string;
  rotulo: string;
  tipo: "total" | "delta";
  valor: number;
  base: number;
  favoravel: boolean;
}

/**
 * Ponte de RESULTADO LÍQUIDO do orçado ao realizado, em 5 efeitos:
 * Receita, Custos, Despesas, Financeiro, Impostos. A soma fecha com ΔLucro líquido.
 */
export function ponteResultado(dados: DreResposta, p: Periodo): PassoPonte[] {
  const eff = (campo: Campo) => {
    const b = blocosDre(dados, campo, p);
    return {
      receita: b.receita,
      custos: b.custos,
      despesas: b.sgae + b.outrasOp,
      financeiro: b.financeiro,
      impostos: b.ir,
      ll: b.lucroLiquido,
    };
  };
  const r = eff("realizado");
  const o = eff("planejado");

  const deltas: { chave: string; rotulo: string; valor: number }[] = [
    { chave: "receita", rotulo: "Receita", valor: r.receita - o.receita },
    { chave: "custos", rotulo: "Custos", valor: r.custos - o.custos },
    { chave: "despesas", rotulo: "Despesas", valor: r.despesas - o.despesas },
    { chave: "financeiro", rotulo: "Financeiro", valor: r.financeiro - o.financeiro },
    { chave: "impostos", rotulo: "Impostos", valor: r.impostos - o.impostos },
  ];

  const passos: PassoPonte[] = [];
  passos.push({ chave: "plan", rotulo: "LL Orçado", tipo: "total", valor: o.ll, base: 0, favoravel: true });
  let acc = o.ll;
  for (const d of deltas) {
    const base = d.valor >= 0 ? acc : acc + d.valor;
    passos.push({ chave: d.chave, rotulo: d.rotulo, tipo: "delta", valor: d.valor, base, favoravel: d.valor >= 0 });
    acc += d.valor;
  }
  passos.push({ chave: "real", rotulo: "LL Realizado", tipo: "total", valor: r.ll, base: 0, favoravel: true });
  return passos;
}

/**
 * Último mês com RECEITA realizada (não apenas qualquer lançamento).
 * Meses sem operação real trazem só resíduos (depreciações/provisões) com
 * receita = 0; usá-los como fim do YTD compararia meses parciais de realizado
 * com o orçamento cheio. Por isso o corte é pela receita (3.1).
 */
export function ultimoMesComDado(dados: DreResposta | null): number {
  if (!dados) return new Date().getMonth();
  const receita = dados.linhas.find((l) => l.codigo === "3.1");
  if (!receita) return new Date().getMonth();
  let ultimo = 0;
  for (let m = 0; m < 12; m++) if (receita.realizado[m] !== 0) ultimo = m;
  return ultimo;
}
