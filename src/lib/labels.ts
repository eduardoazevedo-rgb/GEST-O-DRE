import type { UserRole } from "./types";

export const userRoleLabel: Record<UserRole, string> = {
  admin: "Administrador",
  gestor: "Usuário",
};

export const userRoleOptions = Object.entries(userRoleLabel).map(([value, label]) => ({ value, label }));

export const MESES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function formatNumero(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatPct(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
