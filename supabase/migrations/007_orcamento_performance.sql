-- ============================================================
--  Performance do RLS no orçamento (e refinamento do realizado)
--  As policies de orcamento_valores chamavam uma pilha de funções
--  por linha (user_tem_empresa → is_admin → ...), cada uma com seus
--  próprios subplans — estourava o statement_timeout em tabelas
--  grandes. Achatamos cada checagem em UMA função security definer
--  com uma única expressão SQL (poucos index lookups por linha).
-- ============================================================

-- 1. Orçamento: leitura (inclui ancestrais p/ árvore) e escrita
create or replace function user_ve_orcamento(p_versao uuid, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select role, ativo, restringe_empresas, restringe_contas
    from profiles where id = auth.uid()
  ),
  v as (select empresa_id from orcamento_versoes where id = p_versao)
  select coalesce((
    select case
      when not me.ativo then false
      when me.role = 'admin' then true
      else
        (not me.restringe_empresas or exists (
          select 1 from usuario_empresas ue
          where ue.user_id = auth.uid() and ue.empresa_id = v.empresa_id))
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

create or replace function user_edita_orcamento(p_versao uuid, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select role, ativo, restringe_empresas, restringe_contas
    from profiles where id = auth.uid()
  ),
  v as (select empresa_id from orcamento_versoes where id = p_versao)
  select coalesce((
    select case
      when not me.ativo then false
      when me.role = 'admin' then true
      else
        (not me.restringe_empresas or exists (
          select 1 from usuario_empresas ue
          where ue.user_id = auth.uid() and ue.empresa_id = v.empresa_id))
        and
        (not me.restringe_contas or exists (
          select 1 from usuario_contas uc
          where uc.user_id = auth.uid() and uc.empresa_id = v.empresa_id
            and (p_codigo = uc.codigo or p_codigo like uc.codigo || '.%')))
    end
    from me, v
  ), false)
$$;

drop policy if exists "orc_valores: leitura" on orcamento_valores;
create policy "orc_valores: leitura" on orcamento_valores for select
  using (user_ve_orcamento(versao_id, codigo_gerencial));

drop policy if exists "orc_valores: insert" on orcamento_valores;
create policy "orc_valores: insert" on orcamento_valores for insert
  with check (user_edita_orcamento(versao_id, codigo_gerencial));

drop policy if exists "orc_valores: update" on orcamento_valores;
create policy "orc_valores: update" on orcamento_valores for update
  using (user_edita_orcamento(versao_id, codigo_gerencial));

-- 2. Realizado: mesma técnica (uma função, uma expressão)
create or replace function user_ve_classificacao(p_empresa smallint, p_classif text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select role, ativo, restringe_empresas, restringe_contas
    from profiles where id = auth.uid()
  )
  select coalesce((
    select case
      when not me.ativo then false
      when me.role = 'admin' then true
      else
        (not me.restringe_empresas or exists (
          select 1 from usuario_empresas ue
          where ue.user_id = auth.uid() and ue.empresa_id = p_empresa))
        and (
          not me.restringe_contas
            and exists (select 1 from de_para_contas d
                        where d.empresa_id = p_empresa and d.cd_classificacao_erp = p_classif)
          or exists (
            select 1
            from de_para_contas d
            join usuario_contas uc
              on uc.user_id = auth.uid() and uc.empresa_id = d.empresa_id
            where d.empresa_id = p_empresa
              and d.cd_classificacao_erp = p_classif
              and (d.codigo_gerencial = uc.codigo or d.codigo_gerencial like uc.codigo || '.%')
          )
        )
    end
    from me
  ), false)
$$;
