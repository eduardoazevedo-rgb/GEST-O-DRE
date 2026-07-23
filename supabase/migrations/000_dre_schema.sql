-- ============================================================
--  DREApp — Schema do banco (Supabase)
--  Gestão do DRE: Planejado vs Realizado
-- ============================================================

create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. ENUMS
-- ============================================================
do $$ begin
  create type user_role as enum ('admin','gestor');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 2. PERFIS (Supabase Auth)
-- ============================================================
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text        not null,
  role       user_role   not null default 'gestor',
  created_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nome, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'gestor')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

-- ============================================================
-- 3. EMPRESAS
-- ============================================================
create table if not exists empresas (
  id     smallint primary key,
  codigo text not null unique,
  nome   text not null
);

insert into empresas (id, codigo, nome)
values (1, 'HOFF', 'HOFF')
on conflict (id) do nothing;

-- ============================================================
-- 4. PLANO DE CONTAS GERENCIAL (níveis N2..N5 do DRE)
--    codigo: '3.4.2.01.001' — a hierarquia é dada pelos segmentos
-- ============================================================
create table if not exists plano_contas (
  id         uuid primary key default uuid_generate_v4(),
  empresa_id smallint not null references empresas(id),
  codigo     text     not null,
  nome       text     not null,
  nivel      smallint not null,               -- nº de segmentos do código (2..5)
  natureza   smallint not null default -1,    -- +1 receita, -1 despesa (sinal contábil esperado)
  exibir_dre boolean  not null default true,  -- false p/ contas patrimoniais/implantação
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create index if not exists idx_plano_contas_empresa on plano_contas(empresa_id);

-- ============================================================
-- 5. DE-PARA: conta contábil do ERP -> conta gerencial
-- ============================================================
create table if not exists de_para_contas (
  id                   uuid primary key default uuid_generate_v4(),
  empresa_id           smallint not null references empresas(id),
  cd_classificacao_erp text     not null,  -- ex.: '5.1.1.08.001'
  codigo_gerencial     text     not null,  -- ex.: '3.4.1.08.001'
  created_at           timestamptz not null default now(),
  unique (empresa_id, cd_classificacao_erp)
);

-- ============================================================
-- 6. REALIZADO (sincronizado do ERP Firebird — agregado mensal)
--    Escrita apenas via service role (job de sincronização)
-- ============================================================
create table if not exists realizado_erp (
  id                   uuid primary key default uuid_generate_v4(),
  empresa_id           smallint not null references empresas(id),
  cd_empresa_erp       integer  not null,      -- filial no ERP (1000..1024)
  competencia          date     not null,      -- 1º dia do mês
  cd_conta_erp         integer  not null,
  cd_classificacao_erp text     not null,
  ds_conta_erp         text     not null,
  valor                numeric(15,2) not null, -- crédito - débito (receita +, despesa -)
  sincronizado_em      timestamptz not null default now(),
  unique (empresa_id, cd_empresa_erp, competencia, cd_conta_erp)
);

create index if not exists idx_realizado_competencia on realizado_erp(empresa_id, competencia);
create index if not exists idx_realizado_classif     on realizado_erp(cd_classificacao_erp);

-- ============================================================
-- 7. ORÇAMENTO (planejado) com versões
-- ============================================================
create table if not exists orcamento_versoes (
  id         uuid primary key default uuid_generate_v4(),
  empresa_id smallint not null references empresas(id),
  ano        integer  not null check (ano between 2000 and 2099),
  nome       text     not null default 'Orçamento',
  ativa      boolean  not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_orcamento_versoes_ano on orcamento_versoes(empresa_id, ano);

create table if not exists orcamento_valores (
  id               uuid primary key default uuid_generate_v4(),
  versao_id        uuid     not null references orcamento_versoes(id) on delete cascade,
  codigo_gerencial text     not null,
  mes              smallint not null check (mes between 1 and 12),
  valor            numeric(15,2) not null default 0,
  updated_at       timestamptz not null default now(),
  unique (versao_id, codigo_gerencial, mes)
);

-- ============================================================
-- 8. LOG DE SINCRONIZAÇÃO
-- ============================================================
create table if not exists sync_log (
  id            bigint generated always as identity primary key,
  iniciado_em   timestamptz not null default now(),
  finalizado_em timestamptz,
  status        text not null default 'executando',  -- executando | ok | erro
  ano           integer,
  linhas        integer,
  mensagem      text
);

-- ============================================================
-- 9. updated_at automático
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ declare
  t text;
begin
  foreach t in array array['plano_contas','orcamento_valores']
  loop
    execute format('
      drop trigger if exists trg_updated_at on %I;
      create trigger trg_updated_at
        before update on %I
        for each row execute function set_updated_at();
    ', t, t);
  end loop;
end $$;

-- ============================================================
-- 10. RLS
-- ============================================================
alter table profiles          enable row level security;
alter table empresas          enable row level security;
alter table plano_contas      enable row level security;
alter table de_para_contas    enable row level security;
alter table realizado_erp     enable row level security;
alter table orcamento_versoes enable row level security;
alter table orcamento_valores enable row level security;
alter table sync_log          enable row level security;

-- profiles
create policy "profiles: usuario le o proprio"
  on profiles for select using (id = auth.uid());
create policy "profiles: admin le todos"
  on profiles for select using (current_user_role() = 'admin');
create policy "profiles: usuario atualiza o proprio"
  on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- leitura para autenticados
create policy "empresas: leitura"          on empresas          for select using (auth.uid() is not null);
create policy "plano_contas: leitura"      on plano_contas      for select using (auth.uid() is not null);
create policy "de_para: leitura"           on de_para_contas    for select using (auth.uid() is not null);
create policy "realizado: leitura"         on realizado_erp     for select using (auth.uid() is not null);
create policy "orc_versoes: leitura"       on orcamento_versoes for select using (auth.uid() is not null);
create policy "orc_valores: leitura"       on orcamento_valores for select using (auth.uid() is not null);
create policy "sync_log: leitura"          on sync_log          for select using (auth.uid() is not null);

-- escrita: plano/de-para apenas admin
create policy "plano_contas: insert admin" on plano_contas for insert with check (current_user_role() = 'admin');
create policy "plano_contas: update admin" on plano_contas for update using (current_user_role() = 'admin');
create policy "plano_contas: delete admin" on plano_contas for delete using (current_user_role() = 'admin');
create policy "de_para: insert admin"      on de_para_contas for insert with check (current_user_role() = 'admin');
create policy "de_para: update admin"      on de_para_contas for update using (current_user_role() = 'admin');
create policy "de_para: delete admin"      on de_para_contas for delete using (current_user_role() = 'admin');

-- orçamento: admin e gestor
create policy "orc_versoes: insert" on orcamento_versoes for insert with check (auth.uid() is not null);
create policy "orc_versoes: update" on orcamento_versoes for update using (auth.uid() is not null);
create policy "orc_versoes: delete admin" on orcamento_versoes for delete using (current_user_role() = 'admin');
create policy "orc_valores: insert" on orcamento_valores for insert with check (auth.uid() is not null);
create policy "orc_valores: update" on orcamento_valores for update using (auth.uid() is not null);
create policy "orc_valores: delete admin" on orcamento_valores for delete using (current_user_role() = 'admin');

-- realizado_erp e sync_log: sem policy de escrita — apenas service role (job de sync)
