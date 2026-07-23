-- ============================================================
--  Unidades (filiais do ERP, cd_empresa 1000..1024)
--  A restrição "por empresa" passa a ser por UNIDADE: o admin marca
--  quais unidades o usuário enxerga e o realizado é filtrado por
--  cd_empresa_erp. Plano/orçamento não têm dimensão de unidade —
--  para eles, ter qualquer unidade da empresa dá acesso à empresa.
--  Vínculo legado em usuario_empresas continua valendo como
--  "todas as unidades da empresa".
-- ============================================================

create table if not exists filiais (
  cd_empresa integer  primary key,          -- código da unidade no ERP
  empresa_id smallint not null default 1 references empresas(id),
  nome       text     not null,
  created_at timestamptz not null default now()
);

insert into filiais (cd_empresa, empresa_id, nome) values
  (1000, 1, 'MATRIZ - PORTAO / RS'),
  (1001, 1, 'RECAPAGEM - PORTAO / RS'),
  (1002, 1, 'CENTRO DE SERVICOS - PORTAO / RS'),
  (1003, 1, 'RECAPAGEM - SAO SEBASTIAO DO CAI / RS'),
  (1004, 1, 'CENTRO DE SERVICOS - PORTO ALEGRE / RS'),
  (1005, 1, 'CENTRO DE SERVICOS - CANOAS / RS'),
  (1006, 1, 'RECAPAGEM - IJUI / RS'),
  (1007, 1, 'CENTRO DE SERVICOS - IJUI / RS'),
  (1008, 1, 'CENTRO DE SERVICOS - CAXIAS DO SUL / RS'),
  (1009, 1, 'CENTRO DE SERVICOS - URUGUAIANA / RS'),
  (1010, 1, 'CENTRO DE SERVICOS - PASSO FUNDO / RS'),
  (1011, 1, 'CENTRO DE SERVICOS - MARAU / RS'),
  (1012, 1, 'CENTRO DE SERVICOS - SANTA MARIA / RS'),
  (1013, 1, 'CENTRO DE SERVICOS - CARAZINHO / RS'),
  (1014, 1, 'CENTRO DE SERVICOS - LAJEADO / RS'),
  (1015, 1, 'CENTRO DE SERVICOS - ILHOTA / SC'),
  (1016, 1, 'RECAPAGEM - TIJUCAS / SC'),
  (1017, 1, 'CENTRO DE SERVICOS - PELOTAS / RS'),
  (1018, 1, 'CENTRO DE SERVICOS - JOINVILLE / SC'),
  (1019, 1, 'CENTRO DE SERVICOS - GUARAMIRIM / SC'),
  (1020, 1, 'CENTRO DE SERVICOS - LAGES / SC'),
  (1021, 1, 'CENTRO DE SERVICOS - ARAUCARIA / PR'),
  (1022, 1, 'RECAPAGEM - CAMBE / PR'),
  (1023, 1, 'CENTRO DE SERVICOS - CAMBE / PR'),
  (1024, 1, 'CENTRO DE SERVICOS - BLUMENAU / SC')
on conflict (cd_empresa) do update set nome = excluded.nome;

create table if not exists usuario_filiais (
  user_id    uuid    not null references profiles(id) on delete cascade,
  cd_empresa integer not null references filiais(cd_empresa) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, cd_empresa)
);
create index if not exists idx_usuario_filiais_user on usuario_filiais(user_id);

-- ============================================================
-- RLS das novas tabelas
-- ============================================================
alter table filiais         enable row level security;
alter table usuario_filiais enable row level security;

drop policy if exists "filiais: leitura"      on filiais;
drop policy if exists "filiais: admin insert" on filiais;
drop policy if exists "filiais: admin update" on filiais;
drop policy if exists "filiais: admin delete" on filiais;
create policy "filiais: leitura"      on filiais for select using (is_admin() or is_usuario_ativo());
create policy "filiais: admin insert" on filiais for insert with check (is_admin());
create policy "filiais: admin update" on filiais for update using (is_admin());
create policy "filiais: admin delete" on filiais for delete using (is_admin());

drop policy if exists "usuario_filiais: leitura"      on usuario_filiais;
drop policy if exists "usuario_filiais: admin insert" on usuario_filiais;
drop policy if exists "usuario_filiais: admin update" on usuario_filiais;
drop policy if exists "usuario_filiais: admin delete" on usuario_filiais;
create policy "usuario_filiais: leitura"      on usuario_filiais for select using (user_id = auth.uid() or is_admin());
create policy "usuario_filiais: admin insert" on usuario_filiais for insert with check (is_admin());
create policy "usuario_filiais: admin update" on usuario_filiais for update using (is_admin());
create policy "usuario_filiais: admin delete" on usuario_filiais for delete using (is_admin());

-- ============================================================
-- Acesso à empresa: vínculo direto OU qualquer unidade da empresa
-- ============================================================
create or replace function user_tem_empresa(p_empresa smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and (
    not user_restringe_empresas()
    or exists (
      select 1 from usuario_empresas
      where user_id = auth.uid() and empresa_id = p_empresa
    )
    or exists (
      select 1 from usuario_filiais uf
      join filiais f on f.cd_empresa = uf.cd_empresa
      where uf.user_id = auth.uid() and f.empresa_id = p_empresa
    )
  ))
$$;

-- ============================================================
-- Realizado: checagem única por linha (unidade + conta)
-- ============================================================
create or replace function user_ve_realizado(p_empresa smallint, p_cd integer, p_classif text)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select role, ativo, restringe_empresas, restringe_contas
    from profiles where id = auth.uid()
  )
  select coalesce((
    select case
      when not me.ativo then false
      when me.role = 'admin' then true
      else
        (not me.restringe_empresas
          or exists (select 1 from usuario_filiais uf
                     where uf.user_id = auth.uid() and uf.cd_empresa = p_cd)
          or exists (select 1 from usuario_empresas ue
                     where ue.user_id = auth.uid() and ue.empresa_id = p_empresa))
        and (
          not me.restringe_contas
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
    end
    from me
  ), false)
$$;

drop policy if exists "realizado: leitura" on realizado_erp;
create policy "realizado: leitura" on realizado_erp for select
  using (user_ve_realizado(empresa_id, cd_empresa_erp, cd_classificacao_erp));

-- ============================================================
-- RPC do DRE: filtro de unidade set-based
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
  from realizado_erp r
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
      is_admin()  -- admin vê tudo, inclusive classificações sem de-para
      or r.cd_classificacao_erp in (select p.cd_classificacao_erp from permitidas p)
    )
  group by r.cd_classificacao_erp, extract(month from r.competencia)
$$;
