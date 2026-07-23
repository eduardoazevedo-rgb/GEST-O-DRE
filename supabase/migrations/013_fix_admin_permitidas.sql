-- ============================================================
--  Fix: o CTE `permitidas` (lista de contas visíveis) desses dois RPCs não
--  tinha o bypass de admin. Um admin com restringe_contas=true (e sem linhas
--  em usuario_contas) gerava lista vazia → join sem resultado. A DRE não sofria
--  porque lá o is_admin() está no filtro principal. Adiciona is_admin() ao CTE.
-- ============================================================

create or replace function custo_fornecedor_conta(p_empresa smallint, p_ano integer, p_codigo text)
returns table (
  cd_empresa_erp integer, filial_nome text, cd_pessoa integer,
  fornecedor_nome text, mes integer, valor numeric
)
language sql stable security definer set search_path = public
as $$
  with permitidas as (
    select d.cd_classificacao_erp
    from de_para_contas d
    where d.empresa_id = p_empresa
      and (d.codigo_gerencial = p_codigo or d.codigo_gerencial like p_codigo || '.%')
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
    r.cd_empresa_erp,
    coalesce(f.nome, 'Unidade ' || r.cd_empresa_erp) as filial_nome,
    r.cd_pessoa,
    coalesce(fo.nome, 'Sem fornecedor') as fornecedor_nome,
    extract(month from r.competencia)::integer as mes,
    sum(r.valor) as valor
  from realizado_erp r
  join permitidas pc on pc.cd_classificacao_erp = r.cd_classificacao_erp
  left join filiais f on f.cd_empresa = r.cd_empresa_erp
  left join fornecedores fo on fo.cd_pessoa = r.cd_pessoa
  where r.empresa_id = p_empresa
    and r.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and user_tem_empresa(p_empresa)
    and (
      is_admin()
      or not user_restringe_empresas()
      or exists (select 1 from usuario_empresas ue where ue.user_id = auth.uid() and ue.empresa_id = p_empresa)
      or r.cd_empresa_erp in (select uf.cd_empresa from usuario_filiais uf where uf.user_id = auth.uid())
    )
  group by r.cd_empresa_erp, f.nome, r.cd_pessoa, fo.nome, extract(month from r.competencia)
$$;

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
