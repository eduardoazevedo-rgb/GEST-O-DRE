-- ============================================================
--  Acesso por MÓDULO (aba do portal) por usuário.
--  Generaliza as flags avulsas de profiles (pode_ver_viagens,
--  pode_ver_auditoria) numa lista: cada linha libera um módulo para o
--  usuário. Admin continua vendo tudo, independente da tabela.
--  Módulos: executivo, dre, custos, viagens, auditoria, orcamento.
--  (plano-contas, sincronizacao e usuarios seguem sendo só de admin.)
-- ============================================================

create table if not exists usuario_modulos (
  user_id    uuid not null references profiles(id) on delete cascade,
  modulo     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, modulo)
);

create index if not exists idx_usuario_modulos_user on usuario_modulos(user_id);

alter table usuario_modulos enable row level security;

drop policy if exists "usuario_modulos: leitura"      on usuario_modulos;
drop policy if exists "usuario_modulos: admin insert" on usuario_modulos;
drop policy if exists "usuario_modulos: admin update" on usuario_modulos;
drop policy if exists "usuario_modulos: admin delete" on usuario_modulos;
-- Cada um lê os próprios módulos (a sidebar precisa disso); admin lê todos.
create policy "usuario_modulos: leitura"      on usuario_modulos for select using (is_admin() or user_id = auth.uid());
create policy "usuario_modulos: admin insert" on usuario_modulos for insert with check (is_admin());
create policy "usuario_modulos: admin update" on usuario_modulos for update using (is_admin());
create policy "usuario_modulos: admin delete" on usuario_modulos for delete using (is_admin());

create or replace function user_tem_modulo(p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and exists (
    select 1 from usuario_modulos m where m.user_id = auth.uid() and m.modulo = p_modulo
  ))
$$;

-- ------------------------------------------------------------
-- Seed: preserva exatamente o acesso que cada usuário já tinha.
-- Todo não-admin ativo ganha os módulos que a sidebar já mostrava a
-- todo mundo; viagens e auditoria só para quem tinha a flag ligada.
-- ------------------------------------------------------------
insert into usuario_modulos (user_id, modulo)
select p.id, m.modulo
  from profiles p
  cross join (values ('executivo'), ('dre'), ('custos'), ('orcamento')) as m(modulo)
 where p.role <> 'admin'
on conflict do nothing;

insert into usuario_modulos (user_id, modulo)
select p.id, 'viagens' from profiles p where p.role <> 'admin' and coalesce(p.pode_ver_viagens, false)
on conflict do nothing;

insert into usuario_modulos (user_id, modulo)
select p.id, 'auditoria' from profiles p where p.role <> 'admin' and coalesce(p.pode_ver_auditoria, false)
on conflict do nothing;

-- ------------------------------------------------------------
-- As funções de RLS de viagens/auditoria passam a ler a tabela nova,
-- para não existirem duas fontes de verdade. Assinatura e semântica
-- iguais — só muda de onde vem o "pode".
-- ------------------------------------------------------------
create or replace function user_ve_viagens()
returns boolean language sql stable security definer set search_path = public as $$
  select user_tem_modulo('viagens')
$$;

create or replace function user_ve_auditoria()
returns boolean language sql stable security definer set search_path = public as $$
  select user_tem_modulo('auditoria')
$$;

-- Importar viagens continua sendo uma AÇÃO (flag no profile), mas exige o módulo.
create or replace function user_importa_viagens()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (
    user_tem_modulo('viagens')
    and coalesce((select p.pode_importar_viagens from profiles p where p.id = auth.uid()), false)
  )
$$;
