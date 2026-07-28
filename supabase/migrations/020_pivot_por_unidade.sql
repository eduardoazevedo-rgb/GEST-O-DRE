-- ============================================================
--  Realizado pivotado (conta × 12 meses) de UMA unidade.
--  Mesma função da migração 018, com o filtro extra por filial, para a tela
--  Análise de custos poder ler o relatório de uma unidade só. O controle de
--  acesso é idêntico: quem só enxerga certas filiais não consegue pedir outra
--  (o filtro do usuário continua valendo por cima do p_filial).
-- ============================================================

create or replace function public.dre_realizado_pivot_unidade(p_empresa smallint, p_ano integer, p_filial integer)
returns table(cd_classificacao_erp text, ds_conta_erp text, valores numeric[])
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_admin      boolean := is_admin();
  v_tem        boolean := user_tem_empresa(p_empresa);
  v_emp_const  boolean;
  v_filiais    integer[];
  v_classifs   text[];
begin
  if not v_tem then
    return;
  end if;

  v_emp_const := v_admin
    or not user_restringe_empresas()
    or exists (select 1 from usuario_empresas ue
               where ue.user_id = auth.uid() and ue.empresa_id = p_empresa);

  select array_agg(uf.cd_empresa) into v_filiais
  from usuario_filiais uf where uf.user_id = auth.uid();

  if not v_admin then
    select array_agg(d.cd_classificacao_erp) into v_classifs
    from de_para_contas d
    where d.empresa_id = p_empresa
      and (
        not user_restringe_contas()
        or exists (select 1 from usuario_contas uc
                   where uc.user_id = auth.uid() and uc.empresa_id = d.empresa_id
                     and (d.codigo_gerencial = uc.codigo or d.codigo_gerencial like uc.codigo || '.%'))
      );
  end if;

  return query
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
    and r.cd_empresa_erp = p_filial
    and (v_emp_const or r.cd_empresa_erp = any(coalesce(v_filiais, '{}'::integer[])))
    and (v_admin or r.cd_classificacao_erp = any(coalesce(v_classifs, '{}'::text[])))
  group by r.cd_classificacao_erp;
end;
$function$;
