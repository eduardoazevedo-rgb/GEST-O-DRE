-- ============================================================
--  Custo por fornecedor — v2: cd_pessoa direto na realizado_erp.
--  A tabela separada realizado_fornecedor filtrava por classe do ERP
--  (LIKE '3.%'), mas o de_para é uma TRADUÇÃO (ERP classes 3-6 → gerencial
--  3.x), então as contas de custo/despesa (que vêm das classes 4/5/6 do ERP)
--  ficavam sem fornecedor. Solução: manter cd_pessoa na própria realizado_erp
--  (mesma origem/filtros/classes da DRE) e a visão de fornecedor lê dela.
-- ============================================================

alter table realizado_erp add column if not exists cd_pessoa integer;
create index if not exists idx_realizado_erp_pessoa on realizado_erp (cd_pessoa);

-- RPC de custo por fornecedor agora lê realizado_erp (mesma tradução da DRE).
create or replace function custo_fornecedor_conta(p_empresa smallint, p_ano integer, p_codigo text)
returns table (
  cd_empresa_erp integer,
  filial_nome    text,
  cd_pessoa      integer,
  fornecedor_nome text,
  mes            integer,
  valor          numeric
)
language sql stable security definer set search_path = public
as $$
  with permitidas as (
    select d.cd_classificacao_erp
    from de_para_contas d
    where d.empresa_id = p_empresa
      and (d.codigo_gerencial = p_codigo or d.codigo_gerencial like p_codigo || '.%')
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

-- A tabela separada não é mais necessária.
drop table if exists realizado_fornecedor;

-- A UNIQUE antiga não considerava o fornecedor; agora o grão inclui cd_pessoa.
-- NULLS NOT DISTINCT mantém "Sem fornecedor" (cd_pessoa nulo) único por chave.
alter table realizado_erp drop constraint if exists realizado_erp_empresa_id_cd_empresa_erp_competencia_cd_cont_key;
alter table realizado_erp drop constraint if exists realizado_erp_grao_key;
alter table realizado_erp add constraint realizado_erp_grao_key
  unique nulls not distinct (empresa_id, cd_empresa_erp, competencia, cd_conta_erp, cd_pessoa);
