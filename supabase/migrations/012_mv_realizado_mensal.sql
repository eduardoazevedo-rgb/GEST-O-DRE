-- ============================================================
--  Performance: a realizado_erp agora tem grão de fornecedor (~1,1M linhas),
--  o que fez a agregação do DRE estourar o statement timeout. Solução:
--  uma MATERIALIZED VIEW agregada SEM o fornecedor (grão empresa × unidade ×
--  competência × classificação) que o DRE lê. O detalhe por fornecedor
--  continua lendo a realizado_erp. A MV é atualizada ao final de cada sync.
-- ============================================================

drop materialized view if exists mv_realizado_mensal;
create materialized view mv_realizado_mensal as
  select
    empresa_id,
    cd_empresa_erp,
    competencia,
    cd_classificacao_erp,
    min(ds_conta_erp) as ds_conta_erp,
    sum(valor)        as valor
  from realizado_erp
  group by empresa_id, cd_empresa_erp, competencia, cd_classificacao_erp;

-- Unique index (necessário p/ REFRESH ... CONCURRENTLY) + index de leitura.
create unique index if not exists mv_realizado_mensal_uk
  on mv_realizado_mensal (empresa_id, cd_empresa_erp, competencia, cd_classificacao_erp);
create index if not exists mv_realizado_mensal_comp
  on mv_realizado_mensal (empresa_id, competencia);
create index if not exists mv_realizado_mensal_classif
  on mv_realizado_mensal (cd_classificacao_erp);

-- Atualização da MV, chamável pela sync (service role) após gravar.
create or replace function refresh_realizado_mv()
returns void language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently mv_realizado_mensal;
exception when others then
  -- primeira carga (sem dados) não permite CONCURRENTLY
  refresh materialized view mv_realizado_mensal;
end;
$$;

-- ============================================================
-- DRE mensal: passa a ler a MV (sem o fornecedor). Mesma assinatura/retorno.
-- ============================================================
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
  from mv_realizado_mensal r
  where r.empresa_id = p_empresa
    and r.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and user_tem_empresa(p_empresa)
    and (
      is_admin()
      or not user_restringe_empresas()
      or exists (select 1 from usuario_empresas ue
                 where ue.user_id = auth.uid() and ue.empresa_id = p_empresa)
      or r.cd_empresa_erp in (select uf.cd_empresa from usuario_filiais uf where uf.user_id = auth.uid())
    )
    and (
      is_admin()
      or r.cd_classificacao_erp in (select p.cd_classificacao_erp from permitidas p)
    )
  group by r.cd_classificacao_erp, extract(month from r.competencia)
$$;

-- ============================================================
-- Realizado por unidade (executivo): também lê a MV.
-- ============================================================
create or replace function dre_realizado_por_unidade(p_empresa smallint, p_ano integer)
returns table (cd_empresa_erp integer, filial_nome text, codigo_n2 text, mes integer, valor numeric)
language sql stable security definer set search_path = public
as $$
  with permitidas as (
    select
      d.cd_classificacao_erp,
      split_part(d.codigo_gerencial, '.', 1) || '.' || split_part(d.codigo_gerencial, '.', 2) as codigo_n2
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
    r.cd_empresa_erp,
    coalesce(f.nome, 'Unidade ' || r.cd_empresa_erp) as filial_nome,
    p.codigo_n2,
    extract(month from r.competencia)::integer as mes,
    sum(r.valor) as valor
  from mv_realizado_mensal r
  join permitidas p on p.cd_classificacao_erp = r.cd_classificacao_erp
  left join filiais f on f.cd_empresa = r.cd_empresa_erp
  where r.empresa_id = p_empresa
    and r.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and user_tem_empresa(p_empresa)
    and (
      is_admin()
      or not user_restringe_empresas()
      or exists (select 1 from usuario_empresas ue where ue.user_id = auth.uid() and ue.empresa_id = p_empresa)
      or r.cd_empresa_erp in (select uf.cd_empresa from usuario_filiais uf where uf.user_id = auth.uid())
    )
  group by r.cd_empresa_erp, f.nome, p.codigo_n2, extract(month from r.competencia)
$$;
