-- ============================================================
--  Performance do custo_fornecedor_conta (tela Análise de custos).
--  Mesmo problema/correção da migração 018: permissões calculadas UMA vez em
--  variáveis (não por linha da realizado_erp, ~1,1M linhas). O semi-join com
--  "permitidas" vira pertencimento a array. Semântica idêntica.
-- ============================================================

create or replace function public.custo_fornecedor_conta(p_empresa smallint, p_ano integer, p_codigo text)
returns table(cd_empresa_erp integer, filial_nome text, cd_pessoa integer, fornecedor_nome text, mes integer, valor numeric)
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

  -- Classificações do ERP sob o código pedido E permitidas ao usuário.
  select array_agg(d.cd_classificacao_erp) into v_classifs
  from de_para_contas d
  where d.empresa_id = p_empresa
    and (d.codigo_gerencial = p_codigo or d.codigo_gerencial like p_codigo || '.%')
    and (
      v_admin
      or not user_restringe_contas()
      or exists (select 1 from usuario_contas uc
                 where uc.user_id = auth.uid() and uc.empresa_id = d.empresa_id
                   and (d.codigo_gerencial = uc.codigo or d.codigo_gerencial like uc.codigo || '.%'))
    );
  if v_classifs is null then
    return; -- nenhuma conta permitida sob o código
  end if;

  return query
  select
    r.cd_empresa_erp,
    coalesce(f.nome, 'Unidade ' || r.cd_empresa_erp) as filial_nome,
    r.cd_pessoa,
    coalesce(fo.nome, 'Sem fornecedor') as fornecedor_nome,
    extract(month from r.competencia)::integer as mes,
    sum(r.valor) as valor
  from realizado_erp r
  left join filiais f on f.cd_empresa = r.cd_empresa_erp
  left join fornecedores fo on fo.cd_pessoa = r.cd_pessoa
  where r.empresa_id = p_empresa
    and r.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
    and r.cd_classificacao_erp = any(v_classifs)
    and (v_emp_const or r.cd_empresa_erp = any(coalesce(v_filiais, '{}'::integer[])))
  group by r.cd_empresa_erp, f.nome, r.cd_pessoa, fo.nome, extract(month from r.competencia);
end;
$function$;
