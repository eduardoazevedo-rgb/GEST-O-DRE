-- ============================================================
--  Auditoria — Ajustes de Inventário (movestoque, operações 998/999).
--  Vem do ERP (Firebird) junto no sync. Sinal: Entrada (998) +, Saída (999) −.
--  Acesso por permissão (admin libera pode_ver_auditoria).
-- ============================================================

alter table profiles add column if not exists pode_ver_auditoria boolean not null default false;

create table if not exists ajustes_inventario (
  id             bigint generated always as identity primary key,
  ano            smallint not null,
  mes            smallint not null,
  cd_empresa     integer,
  cd_item        integer,
  ds_item        text,
  cd_secao       integer,
  ds_secao       text,
  cd_grupo       integer,
  ds_grupo       text,
  cd_marca       integer,
  ds_marca       text,
  cd_historico   integer,
  ds_historico   text,
  tp_operacao    char(1),          -- E (entrada) | S (saída)
  qtd            numeric,
  vl             numeric,
  sincronizado_em timestamptz not null default now()
);
create index if not exists idx_ajustes_ano_mes on ajustes_inventario (ano, mes);
create index if not exists idx_ajustes_empresa on ajustes_inventario (cd_empresa);
create index if not exists idx_ajustes_secao   on ajustes_inventario (ds_secao);

create or replace function user_ve_auditoria()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce((select p.ativo and p.pode_ver_auditoria from profiles p where p.id = auth.uid()), false)
$$;

alter table ajustes_inventario enable row level security;
drop policy if exists "ajustes: leitura" on ajustes_inventario;
create policy "ajustes: leitura" on ajustes_inventario for select using (user_ve_auditoria());
