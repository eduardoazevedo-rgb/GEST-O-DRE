-- ============================================================
--  Custo de Viagens (upload manual de planilha, fora do ERP).
--  Origem: planilha "Hotelaria" (hospedagem + passagens). Preparado para
--  receber depois o reembolso de quilometragem (mesmo modelo, tipo diferente).
--  Substituição por mês fechado: ao importar, os meses presentes no arquivo
--  são apagados e reinseridos.
-- ============================================================

alter table profiles add column if not exists pode_ver_viagens      boolean not null default false;
alter table profiles add column if not exists pode_importar_viagens boolean not null default false;

-- Log de importações (para auditoria / desfazer).
create table if not exists viagens_importacoes (
  id           bigint generated always as identity primary key,
  arquivo      text,
  meses        text[],            -- ex.: {'2026-01','2026-02'}
  linhas       integer,
  importado_por uuid references profiles(id),
  criado_em    timestamptz not null default now()
);

-- Fato: uma linha por alocação (documento × item × centro de custo × viajante).
create table if not exists custo_viagens (
  id              bigint generated always as identity primary key,
  importacao_id   bigint references viagens_importacoes(id) on delete cascade,
  ano             smallint not null,
  mes             smallint not null,          -- 1..12 (de DT_EMISSAO)
  dt_emissao      date,
  cd_empresa      integer,
  documento       text,
  cd_pessoa       integer,
  nm_pessoa       text,                        -- fornecedor (hotel/agência)
  cd_item         text,
  ds_item         text,
  tipo            text not null default 'outro', -- hospedagem | passagem | quilometragem
  qtd             numeric,
  vlr_item        numeric,
  cd_centrocusto  text,
  ds_centrocusto  text,                         -- área
  cd_conta        text,
  ds_conta        text,
  obs             text,
  obs2            text,
  vlr_cc          numeric not null default 0,   -- VALOR (rateado por centro de custo)
  viajante        text,                         -- PESSOA
  criado_em       timestamptz not null default now()
);
create index if not exists idx_viagens_ano_mes  on custo_viagens (ano, mes);
create index if not exists idx_viagens_tipo      on custo_viagens (tipo);
create index if not exists idx_viagens_area      on custo_viagens (ds_centrocusto);

-- ============================================================
-- Permissões
-- ============================================================
create or replace function user_ve_viagens()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce((select p.ativo and p.pode_ver_viagens from profiles p where p.id = auth.uid()), false)
$$;
create or replace function user_importa_viagens()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce((select p.ativo and p.pode_importar_viagens from profiles p where p.id = auth.uid()), false)
$$;

alter table custo_viagens        enable row level security;
alter table viagens_importacoes  enable row level security;

drop policy if exists "custo_viagens: leitura" on custo_viagens;
create policy "custo_viagens: leitura" on custo_viagens for select using (user_ve_viagens());

drop policy if exists "viagens_importacoes: leitura" on viagens_importacoes;
create policy "viagens_importacoes: leitura" on viagens_importacoes for select using (user_ve_viagens());
