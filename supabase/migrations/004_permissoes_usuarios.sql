-- ============================================================
--  Controle de acesso por usuário
--  - profiles.ativo (desativação de usuários)
--  - Vínculos N:N usuário × empresas e usuário × contas gerenciais
--  - RLS: admin vê tudo; usuário comum vê apenas o vinculado
--  Regra de contas: vincular um código dá acesso à subárvore dele
--  (ex.: '3.4.1' cobre '3.4.1.08.001'); os ancestrais ficam
--  visíveis apenas para leitura, para a árvore do DRE renderizar.
-- ============================================================

-- ============================================================
-- 1. Ativação/desativação
-- ============================================================
alter table profiles add column if not exists ativo boolean not null default true;

-- ============================================================
-- 2. Tabelas de vínculo
-- ============================================================
create table if not exists usuario_empresas (
  user_id    uuid     not null references profiles(id) on delete cascade,
  empresa_id smallint not null references empresas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, empresa_id)
);

create table if not exists usuario_contas (
  user_id    uuid     not null references profiles(id) on delete cascade,
  empresa_id smallint not null,
  codigo     text     not null,  -- código gerencial; cobre a subárvore
  created_at timestamptz not null default now(),
  primary key (user_id, empresa_id, codigo),
  foreign key (empresa_id, codigo) references plano_contas(empresa_id, codigo) on delete cascade
);

create index if not exists idx_usuario_contas_user   on usuario_contas(user_id);
create index if not exists idx_usuario_empresas_user on usuario_empresas(user_id);

-- ============================================================
-- 3. Funções auxiliares (security definer: não sofrem RLS)
-- ============================================================
create or replace function is_usuario_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from profiles where id = auth.uid()), false)
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and ativo
  )
$$;

create or replace function user_tem_empresa(p_empresa smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and exists (
    select 1 from usuario_empresas
    where user_id = auth.uid() and empresa_id = p_empresa
  ))
$$;

-- Conta vinculada (o próprio código ou um descendente de um vínculo)
create or replace function user_tem_conta(p_empresa smallint, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and exists (
    select 1 from usuario_contas uc
    where uc.user_id = auth.uid() and uc.empresa_id = p_empresa
      and (p_codigo = uc.codigo or p_codigo like uc.codigo || '.%')
  ))
$$;

-- Conta visível (vinculada, descendente OU ancestral de um vínculo)
create or replace function user_ve_conta(p_empresa smallint, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and exists (
    select 1 from usuario_contas uc
    where uc.user_id = auth.uid() and uc.empresa_id = p_empresa
      and (p_codigo = uc.codigo
        or p_codigo like uc.codigo || '.%'
        or uc.codigo like p_codigo || '.%')
  ))
$$;

-- ============================================================
-- 4. RLS das tabelas de vínculo
-- ============================================================
alter table usuario_empresas enable row level security;
alter table usuario_contas   enable row level security;

drop policy if exists "usuario_empresas: leitura"      on usuario_empresas;
drop policy if exists "usuario_empresas: admin insert" on usuario_empresas;
drop policy if exists "usuario_empresas: admin update" on usuario_empresas;
drop policy if exists "usuario_empresas: admin delete" on usuario_empresas;
create policy "usuario_empresas: leitura"      on usuario_empresas for select using (user_id = auth.uid() or is_admin());
create policy "usuario_empresas: admin insert" on usuario_empresas for insert with check (is_admin());
create policy "usuario_empresas: admin update" on usuario_empresas for update using (is_admin());
create policy "usuario_empresas: admin delete" on usuario_empresas for delete using (is_admin());

drop policy if exists "usuario_contas: leitura"      on usuario_contas;
drop policy if exists "usuario_contas: admin insert" on usuario_contas;
drop policy if exists "usuario_contas: admin update" on usuario_contas;
drop policy if exists "usuario_contas: admin delete" on usuario_contas;
create policy "usuario_contas: leitura"      on usuario_contas for select using (user_id = auth.uid() or is_admin());
create policy "usuario_contas: admin insert" on usuario_contas for insert with check (is_admin());
create policy "usuario_contas: admin update" on usuario_contas for update using (is_admin());
create policy "usuario_contas: admin delete" on usuario_contas for delete using (is_admin());

-- ============================================================
-- 5. Substitui as policies de "todo autenticado lê tudo"
-- ============================================================

-- profiles: admin (ativo) lê todos
drop policy if exists "profiles: admin le todos" on profiles;
create policy "profiles: admin le todos" on profiles for select using (is_admin());

-- empresas
drop policy if exists "empresas: leitura" on empresas;
create policy "empresas: leitura" on empresas for select using (user_tem_empresa(id));

-- plano_contas: leitura restrita; escrita só admin ativo
drop policy if exists "plano_contas: leitura"      on plano_contas;
drop policy if exists "plano_contas: insert admin" on plano_contas;
drop policy if exists "plano_contas: update admin" on plano_contas;
drop policy if exists "plano_contas: delete admin" on plano_contas;
create policy "plano_contas: leitura" on plano_contas for select
  using (user_tem_empresa(empresa_id) and user_ve_conta(empresa_id, codigo));
create policy "plano_contas: insert admin" on plano_contas for insert with check (is_admin());
create policy "plano_contas: update admin" on plano_contas for update using (is_admin());
create policy "plano_contas: delete admin" on plano_contas for delete using (is_admin());

-- de_para: leitura das contas vinculadas (necessário para o DRE); escrita só admin
drop policy if exists "de_para: leitura"      on de_para_contas;
drop policy if exists "de_para: insert admin" on de_para_contas;
drop policy if exists "de_para: update admin" on de_para_contas;
drop policy if exists "de_para: delete admin" on de_para_contas;
create policy "de_para: leitura" on de_para_contas for select
  using (is_admin() or user_tem_conta(empresa_id, codigo_gerencial));
create policy "de_para: insert admin" on de_para_contas for insert with check (is_admin());
create policy "de_para: update admin" on de_para_contas for update using (is_admin());
create policy "de_para: delete admin" on de_para_contas for delete using (is_admin());

-- realizado: só linhas cuja classificação mapeia para conta vinculada.
-- Linhas sem de-para só aparecem para admin.
drop policy if exists "realizado: leitura" on realizado_erp;
create policy "realizado: leitura" on realizado_erp for select
  using (is_admin() or exists (
    select 1 from de_para_contas d
    where d.empresa_id = realizado_erp.empresa_id
      and d.cd_classificacao_erp = realizado_erp.cd_classificacao_erp
      and user_tem_conta(d.empresa_id, d.codigo_gerencial)
  ));

-- orçamento: versões pela empresa; valores pela conta
drop policy if exists "orc_versoes: leitura"      on orcamento_versoes;
drop policy if exists "orc_versoes: insert"       on orcamento_versoes;
drop policy if exists "orc_versoes: update"       on orcamento_versoes;
drop policy if exists "orc_versoes: delete admin" on orcamento_versoes;
create policy "orc_versoes: leitura" on orcamento_versoes for select using (user_tem_empresa(empresa_id));
create policy "orc_versoes: insert"  on orcamento_versoes for insert with check (user_tem_empresa(empresa_id));
create policy "orc_versoes: update"  on orcamento_versoes for update using (user_tem_empresa(empresa_id));
create policy "orc_versoes: delete admin" on orcamento_versoes for delete using (is_admin());

drop policy if exists "orc_valores: leitura"      on orcamento_valores;
drop policy if exists "orc_valores: insert"       on orcamento_valores;
drop policy if exists "orc_valores: update"       on orcamento_valores;
drop policy if exists "orc_valores: delete admin" on orcamento_valores;
create policy "orc_valores: leitura" on orcamento_valores for select
  using (exists (select 1 from orcamento_versoes v
                 where v.id = versao_id and user_ve_conta(v.empresa_id, codigo_gerencial)));
create policy "orc_valores: insert" on orcamento_valores for insert
  with check (exists (select 1 from orcamento_versoes v
                      where v.id = versao_id and user_tem_conta(v.empresa_id, codigo_gerencial)));
create policy "orc_valores: update" on orcamento_valores for update
  using (exists (select 1 from orcamento_versoes v
                 where v.id = versao_id and user_tem_conta(v.empresa_id, codigo_gerencial)));
create policy "orc_valores: delete admin" on orcamento_valores for delete using (is_admin());

-- sync_log: só admin
drop policy if exists "sync_log: leitura" on sync_log;
create policy "sync_log: leitura" on sync_log for select using (is_admin());
