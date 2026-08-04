-- ============================================================
--  Performance da leitura do orçamento (mesma família dos ajustes 018/019).
--
--  A policy de SELECT de orcamento_valores chamava user_ve_orcamento(versao_id,
--  codigo_gerencial) — uma função que, por LINHA, lia profiles, lia a versão e
--  ainda chamava user_tem_empresa (join usuario_filiais × filiais). Com ~4.900
--  linhas por versão dava ~6,8s só na primeira página e estourava o
--  statement_timeout do PostgREST. Antes da migração 023 isso não aparecia
--  porque o usuário restrito por empresa era barrado na primeira condição e
--  nenhuma linha chegava a ser avaliada.
--
--  Correção, em três frentes:
--   1. funções sem argumento entram como (select f()) — assim viram InitPlan
--      (uma vez por consulta) em vez de uma chamada por linha;
--   2. as versões alcançáveis viram subconsulta não correlacionada;
--   3. o casamento de contas por prefixo sai de dentro da policy e vira uma
--      função SECURITY DEFINER: ela resolve os pares (versão, conta) contra o
--      plano de contas SEM passar pela RLS do plano — que, por si só, avalia
--      user_ve_conta em cada uma das 573 contas.
--
--  Semântica preservada: continua valendo empresa (vínculo direto ou por
--  unidade) + conta (o próprio código, um descendente ou um ancestral).
-- ============================================================

-- Pares (versão, código gerencial) que o usuário pode ler. Security definer
-- para não arrastar a RLS de plano_contas/orcamento_versoes para dentro.
create or replace function public.orcamento_pares_permitidos()
returns table(versao_id uuid, codigo_gerencial text)
language sql stable security definer set search_path = public as $$
  select v.id, p.codigo
    from orcamento_versoes v
    join plano_contas p    on p.empresa_id = v.empresa_id
    join usuario_contas uc on uc.user_id = auth.uid() and uc.empresa_id = v.empresa_id
   where user_tem_empresa(v.empresa_id)
     and (p.codigo = uc.codigo
       or p.codigo like uc.codigo || '.%'
       or uc.codigo like p.codigo || '.%')
$$;

-- Versões que o usuário alcança (idem: sem a RLS de orcamento_versoes por linha).
create or replace function public.orcamento_versoes_permitidas()
returns table(id uuid)
language sql stable security definer set search_path = public as $$
  select v.id from orcamento_versoes v where user_tem_empresa(v.empresa_id)
$$;

drop policy if exists "orc_valores: leitura" on orcamento_valores;

create policy "orc_valores: leitura" on orcamento_valores for select using (
  (select is_admin())
  or (
    (select is_usuario_ativo())
    and versao_id in (select id from orcamento_versoes_permitidas())
    and (
      (select not user_restringe_contas())
      or (versao_id, codigo_gerencial) in (select * from orcamento_pares_permitidos())
    )
  )
);

create index if not exists idx_usuario_contas_user_empresa on usuario_contas(user_id, empresa_id);
