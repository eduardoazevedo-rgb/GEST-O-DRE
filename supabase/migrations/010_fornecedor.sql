-- ============================================================
--  Custo por fornecedor
--  Mesma origem do realizado (movtocontabil), mas mantendo a dimensão
--  cd_pessoa (fornecedor). Fato agregado por fornecedor × conta × mês ×
--  unidade. Acesso: exatamente o mesmo do realizado (unidade + conta),
--  via os helpers já existentes (user_ve_realizado / user_tem_empresa).
-- ============================================================

-- Dimensão de fornecedores (pessoa do ERP)
create table if not exists fornecedores (
  cd_pessoa       integer primary key,
  nome            text    not null,
  sincronizado_em timestamptz not null default now()
);

-- Fato: fornecedor × conta × mês × unidade. cd_pessoa nulo = "Sem fornecedor".
create table if not exists realizado_fornecedor (
  id                   bigint generated always as identity primary key,
  empresa_id           smallint not null default 1 references empresas(id),
  cd_empresa_erp       integer  not null,
  competencia          date     not null,
  cd_classificacao_erp text     not null,
  ds_conta_erp         text,
  cd_pessoa            integer,
  valor                numeric(18,2) not null,
  sincronizado_em      timestamptz not null default now()
);

create index if not exists idx_rfor_empresa_comp   on realizado_fornecedor (empresa_id, competencia);
create index if not exists idx_rfor_classif        on realizado_fornecedor (cd_classificacao_erp);
create index if not exists idx_rfor_unidade        on realizado_fornecedor (cd_empresa_erp);
create index if not exists idx_rfor_pessoa         on realizado_fornecedor (cd_pessoa);

-- ============================================================
-- RLS
-- ============================================================
alter table fornecedores          enable row level security;
alter table realizado_fornecedor  enable row level security;

-- Fornecedores é dimensão: qualquer usuário ativo lê os nomes.
drop policy if exists "fornecedores: leitura" on fornecedores;
create policy "fornecedores: leitura" on fornecedores for select
  using (is_admin() or is_usuario_ativo());

-- Fato: mesma checagem por linha do realizado (unidade + conta).
drop policy if exists "realizado_fornecedor: leitura" on realizado_fornecedor;
create policy "realizado_fornecedor: leitura" on realizado_fornecedor for select
  using (user_ve_realizado(empresa_id, cd_empresa_erp, cd_classificacao_erp));

-- ============================================================
-- RPC: detalhe de uma conta gerencial → unidade × fornecedor × mês.
--  p_codigo é um código gerencial (ex.: 3.4.1.08.001). Considera esse
--  código e todos os descendentes (via de-para). Respeita acesso.
-- ============================================================
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
    -- classificações do de-para sob p_codigo, já filtradas pelo acesso a contas
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
  from realizado_fornecedor r
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
