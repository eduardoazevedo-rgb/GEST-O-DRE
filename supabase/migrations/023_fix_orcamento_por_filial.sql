-- ============================================================
--  Correção: o planejado sumia para quem tem acesso por UNIDADE.
--
--  user_tem_empresa() aceita três caminhos de acesso à empresa: perfil não
--  restrito, vínculo explícito em usuario_empresas OU vínculo de unidade
--  (usuario_filiais → filiais.empresa_id). O realizado e o plano de contas usam
--  essa função, então apareciam normalmente.
--
--  Já user_ve_orcamento()/user_edita_orcamento() checavam SÓ usuario_empresas.
--  Resultado: usuário restrito por empresa, com unidades vinculadas mas sem
--  linha em usuario_empresas (caso da Andriele: 25 unidades, 3 contas, 0
--  empresas), via o realizado e não via nenhum valor de orçamento — o DRE e a
--  Análise de custos mostravam o planejado zerado.
--
--  Aqui as duas funções passam a usar user_tem_empresa(), e a tabela
--  usuario_empresas é preenchida a partir das unidades já vinculadas.
-- ============================================================

create or replace function public.user_ve_orcamento(p_versao uuid, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select role, ativo, restringe_contas from profiles where id = auth.uid()
  ),
  v as (select empresa_id from orcamento_versoes where id = p_versao)
  select coalesce((
    select case
      when not me.ativo then false
      when me.role = 'admin' then true
      else
        user_tem_empresa(v.empresa_id)
        and
        (not me.restringe_contas or exists (
          select 1 from usuario_contas uc
          where uc.user_id = auth.uid() and uc.empresa_id = v.empresa_id
            and (p_codigo = uc.codigo
              or p_codigo like uc.codigo || '.%'
              or uc.codigo like p_codigo || '.%')))
    end
    from me, v
  ), false)
$$;

create or replace function public.user_edita_orcamento(p_versao uuid, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select role, ativo, restringe_contas from profiles where id = auth.uid()
  ),
  v as (select empresa_id from orcamento_versoes where id = p_versao)
  select coalesce((
    select case
      when not me.ativo then false
      when me.role = 'admin' then true
      else
        user_tem_empresa(v.empresa_id)
        and
        (not me.restringe_contas or exists (
          select 1 from usuario_contas uc
          where uc.user_id = auth.uid() and uc.empresa_id = v.empresa_id
            and (p_codigo = uc.codigo or p_codigo like uc.codigo || '.%')))
    end
    from me, v
  ), false)
$$;

-- Alinha os dados: quem já tem unidade vinculada ganha a empresa correspondente
-- em usuario_empresas (é o que a tela de Vínculos faz ao salvar hoje).
insert into usuario_empresas (user_id, empresa_id)
select distinct uf.user_id, f.empresa_id
  from usuario_filiais uf
  join filiais f on f.cd_empresa = uf.cd_empresa
on conflict do nothing;

-- Idem para quem tem conta vinculada de uma empresa.
insert into usuario_empresas (user_id, empresa_id)
select distinct uc.user_id, uc.empresa_id from usuario_contas uc
on conflict do nothing;
