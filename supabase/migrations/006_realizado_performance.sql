-- ============================================================
--  Performance do RLS no realizado
--  A policy anterior fazia EXISTS em de_para_contas por linha, e o
--  RLS do próprio de_para disparava funções para cada linha visitada
--  (~20k × 397 avaliações) — estourava o statement_timeout.
--  Correções:
--   1. user_ve_classificacao(): security definer (não dispara RLS
--      aninhado) com lookup indexado único por linha.
--   2. dre_realizado_mensal(): security definer com filtro de
--      permissão set-based (uma única passada), mantendo a assinatura.
-- ============================================================

-- 1. Permissão por classificação do ERP (uma consulta indexada)
create or replace function user_ve_classificacao(p_empresa smallint, p_classif text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (
    is_usuario_ativo()
    and user_tem_empresa(p_empresa)
    and (
      not user_restringe_contas()
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
  )
$$;

drop policy if exists "realizado: leitura" on realizado_erp;
create policy "realizado: leitura" on realizado_erp for select
  using (user_ve_classificacao(empresa_id, cd_classificacao_erp));

-- 2. RPC do DRE: mesmo contrato, filtro de permissão em conjunto
--    (substitui a versão security invoker da migração 002)
create or replace function dre_realizado_mensal(p_empresa smallint, p_ano integer)
returns table (cd_classificacao_erp text, ds_conta_erp text, mes integer, valor numeric)
language sql stable security definer set search_path = public
as $$
  with permitidas as (
    select d.cd_classificacao_erp
    from de_para_contas d
    where d.empresa_id = p_empresa
      and (
        not user_restringe_contas()
        or exists (
          select 1 from usuario_contas uc
          where uc.user_id = auth.uid() and uc.empresa_id = d.empresa_id
            and (d.codigo_gerencial = uc.codigo or d.codigo_gerencial like uc.codigo || '.%')
        )
      )
  )
  select
    r.cd_classificacao_erp,
    min(r.ds_conta_erp) as ds_conta_erp,
    extract(month from r.competencia)::integer as mes,
    sum(r.valor) as valor
  from realizado_erp r
  where r.empresa_id = p_empresa
    and r.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and user_tem_empresa(p_empresa)
    and (
      is_admin()  -- admin vê tudo, inclusive classificações sem de-para
      or r.cd_classificacao_erp in (select p.cd_classificacao_erp from permitidas p)
    )
  group by r.cd_classificacao_erp, extract(month from r.competencia)
$$;
