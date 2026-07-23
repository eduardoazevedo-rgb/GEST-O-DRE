-- ============================================================
--  Realizado por unidade (para o módulo executivo)
--  Devolve o realizado agregado por unidade (cd_empresa_erp) × grupo
--  N2 × mês, respeitando exatamente o mesmo controle de acesso do
--  restante do app: só unidades em usuario_filiais (ou todas, se o
--  usuário não é restrito por unidade / é admin) e só contas visíveis.
--  security definer + filtro set-based para não estourar timeout.
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
  from realizado_erp r
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
