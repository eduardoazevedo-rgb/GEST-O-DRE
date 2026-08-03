// Módulos (abas) que o admin libera por usuário — espelha a tabela
// usuario_modulos e a função user_tem_modulo() no banco (migração 021).
// As telas de admin (Plano de Contas, Sincronização, Usuários) não entram
// aqui: continuam presas ao perfil de administrador.

export const MODULOS = [
  { id: "executivo", label: "Executivo", href: "/executivo" },
  { id: "dre", label: "DRE", href: "/dre" },
  { id: "custos", label: "Análise de custos", href: "/custos" },
  { id: "viagens", label: "Custo de Viagens", href: "/viagens" },
  { id: "auditoria", label: "Auditoria", href: "/auditoria" },
  { id: "orcamento", label: "Orçamento", href: "/orcamento" },
] as const;

export type ModuloId = (typeof MODULOS)[number]["id"];

export const MODULOS_IDS = MODULOS.map((m) => m.id) as ModuloId[];

/** Sugestão ao criar um usuário novo: as abas de análise, sem as sensíveis. */
export const MODULOS_PADRAO: ModuloId[] = ["executivo", "dre", "custos", "orcamento"];

export function ehModulo(v: unknown): v is ModuloId {
  return typeof v === "string" && (MODULOS_IDS as string[]).includes(v);
}

export function rotuloModulo(id: string): string {
  return MODULOS.find((m) => m.id === id)?.label ?? id;
}

/** Módulo exigido por uma rota (null = rota sem trava de módulo). */
export function moduloDaRota(pathname: string): ModuloId | null {
  const m = MODULOS.find((x) => pathname === x.href || pathname.startsWith(x.href + "/"));
  return m ? m.id : null;
}
