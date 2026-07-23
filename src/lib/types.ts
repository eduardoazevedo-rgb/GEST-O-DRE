export type UserRole = "admin" | "gestor";

export interface Profile {
  id: string;
  nome: string;
  role: UserRole;
  ativo: boolean;
  /** Se false, o usuário enxerga todas as empresas (sem precisar de vínculo) */
  restringe_empresas: boolean;
  /** Se false, o usuário enxerga todas as contas (sem precisar de vínculo) */
  restringe_contas: boolean;
  created_at: string;
}

/** Unidade da empresa no ERP (cd_empresa 1000..1024) */
export interface Filial {
  cd_empresa: number;
  empresa_id: number;
  nome: string;
}

/** Vínculo usuário × empresa (usuário comum só enxerga empresas vinculadas) */
export interface UsuarioEmpresa {
  user_id: string;
  empresa_id: number;
}

/** Vínculo usuário × unidade — restringe o realizado por cd_empresa_erp */
export interface UsuarioFilial {
  user_id: string;
  cd_empresa: number;
}

/** Vínculo usuário × conta gerencial — o código cobre a subárvore dele */
export interface UsuarioConta {
  user_id: string;
  empresa_id: number;
  codigo: string;
}

export interface Empresa {
  id: number;
  codigo: string;
  nome: string;
}

export interface PlanoConta {
  id: string;
  empresa_id: number;
  codigo: string;
  nome: string;
  nivel: number;
  natureza: number; // +1 receita, -1 despesa
  exibir_dre: boolean;
}

export interface DeParaConta {
  id: string;
  empresa_id: number;
  cd_classificacao_erp: string;
  codigo_gerencial: string;
}

export interface OrcamentoVersao {
  id: string;
  empresa_id: number;
  ano: number;
  nome: string;
  ativa: boolean;
  created_at: string;
}

export interface OrcamentoValor {
  id: string;
  versao_id: string;
  codigo_gerencial: string;
  mes: number;
  valor: number;
}

export interface SyncLog {
  id: number;
  iniciado_em: string;
  finalizado_em: string | null;
  status: string;
  ano: number | null;
  linhas: number | null;
  mensagem: string | null;
}

/** Linha da matriz do DRE devolvida por /api/dre */
export interface DreLinha {
  codigo: string;
  nome: string;
  nivel: number;
  natureza: number;
  /** índice 0..11 = jan..dez */
  realizado: number[];
  planejado: number[];
  temFilhos: boolean;
}

export interface DreResposta {
  ano: number;
  versaoId: string | null;
  versaoNome: string | null;
  linhas: DreLinha[];
  naoMapeado: { cd_classificacao_erp: string; ds_conta_erp: string; total: number }[];
}
