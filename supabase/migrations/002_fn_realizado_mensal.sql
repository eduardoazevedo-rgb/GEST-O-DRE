-- Agrega o realizado por classificação ERP × mês (reduz o volume trafegado
-- para a API do DRE; a RLS de realizado_erp continua valendo — security invoker).

create or replace function dre_realizado_mensal(p_empresa smallint, p_ano integer)
returns table (cd_classificacao_erp text, ds_conta_erp text, mes integer, valor numeric)
language sql stable
set search_path = public
as $$
  select
    r.cd_classificacao_erp,
    min(r.ds_conta_erp) as ds_conta_erp,
    extract(month from r.competencia)::integer as mes,
    sum(r.valor) as valor
  from realizado_erp r
  where r.empresa_id = p_empresa
    and r.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
  group by r.cd_classificacao_erp, extract(month from r.competencia)
$$;
