-- ============================================================
--  Performance do DRE: o dre_realizado_mensal retorna ~2168 linhas
--  (classificação × mês), acima do limite de 1000 linhas por resposta do
--  PostgREST — então o app paginava e RE-EXECUTAVA a função a cada página.
--  Esta versão retorna PIVOTADA (1 linha por classificação, 12 meses num
--  array) → ~180 linhas → cabe numa única chamada, sem re-execução.
-- ============================================================
create or replace function dre_realizado_pivot(p_empresa smallint, p_ano integer)
returns table (cd_classificacao_erp text, ds_conta_erp text, valores numeric[])
language sql stable security definer set search_path = public
as $$
  with permitidas as (
    select d.cd_classificacao_erp
    from de_para_contas d
    where d.empresa_id = p_empresa
      and (
        is_admin()
        or not user_restringe_contas()
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
    array[
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 1), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 2), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 3), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 4), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 5), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 6), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 7), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 8), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 9), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 10), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 11), 0),
      coalesce(sum(r.valor) filter (where extract(month from r.competencia) = 12), 0)
    ]::numeric[] as valores
  from mv_realizado_mensal r
  where r.empresa_id = p_empresa
    and r.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and user_tem_empresa(p_empresa)
    and (
      is_admin()
      or not user_restringe_empresas()
      or exists (select 1 from usuario_empresas ue where ue.user_id = auth.uid() and ue.empresa_id = p_empresa)
      or r.cd_empresa_erp in (select uf.cd_empresa from usuario_filiais uf where uf.user_id = auth.uid())
    )
    and (
      is_admin()
      or r.cd_classificacao_erp in (select p.cd_classificacao_erp from permitidas p)
    )
  group by r.cd_classificacao_erp
$$;
