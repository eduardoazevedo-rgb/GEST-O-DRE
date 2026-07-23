-- ============================================================
--  Sincronização incremental + fila do botão + permissão.
--  - sync_estado: marcador do último NR_LANCAMENTO processado (CDC) e lock.
--  - sync_pedidos: fila de pedidos (botão "Atualizar agora" e agendados).
--  - profiles.pode_sincronizar: quem pode disparar atualização.
-- ============================================================

alter table profiles add column if not exists pode_sincronizar boolean not null default false;

-- Estado (singleton). O worker (service role) escreve; usuários só leem.
create table if not exists sync_estado (
  id                    smallint primary key default 1 check (id = 1),
  ultimo_nr_lancamento  bigint,
  ultima_competencia    date,
  atualizado_em         timestamptz,
  em_execucao_desde     timestamptz
);
insert into sync_estado (id) values (1) on conflict (id) do nothing;

-- Fila de pedidos de sincronização.
create table if not exists sync_pedidos (
  id             bigint generated always as identity primary key,
  tipo           text not null default 'incremental',   -- incremental | full_ano | full_hist
  params         jsonb,                                  -- ex.: {"ano": 2026}
  origem         text not null default 'botao',          -- botao | agendado
  status         text not null default 'pendente',       -- pendente | executando | ok | erro
  solicitado_por uuid references profiles(id),
  criado_em      timestamptz not null default now(),
  iniciado_em    timestamptz,
  finalizado_em  timestamptz,
  linhas         integer,
  mensagem       text
);
create index if not exists idx_sync_pedidos_status on sync_pedidos (status, criado_em);

-- Quem pode sincronizar: admin sempre, ou usuário ativo com a flag.
create or replace function user_pode_sincronizar()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce(
    (select p.ativo and p.pode_sincronizar from profiles p where p.id = auth.uid()),
    false
  )
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table sync_estado  enable row level security;
alter table sync_pedidos enable row level security;

drop policy if exists "sync_estado: leitura" on sync_estado;
create policy "sync_estado: leitura" on sync_estado for select
  using (is_admin() or is_usuario_ativo());

drop policy if exists "sync_pedidos: leitura" on sync_pedidos;
drop policy if exists "sync_pedidos: insere" on sync_pedidos;
create policy "sync_pedidos: leitura" on sync_pedidos for select
  using (user_pode_sincronizar());
create policy "sync_pedidos: insere" on sync_pedidos for insert
  with check (user_pode_sincronizar() and solicitado_por = auth.uid());
