import { Wallet } from "lucide-react";

// Fluxo de Caixa — aba criada em branco; o conteúdo vai ser desenhado junto com a
// controladoria. Já nasce presa ao módulo "fluxo_caixa" (Usuários → Editar), então
// só admin enxerga até alguém liberar para outros usuários.
export default function FluxoCaixaPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--text)]">Fluxo de Caixa</h1>
        <p className="text-xs text-[var(--text-muted)]">Em construção</p>
      </div>

      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] py-24 text-center">
        <Wallet size={28} className="text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">Esta aba ainda está em branco.</p>
      </div>
    </div>
  );
}
