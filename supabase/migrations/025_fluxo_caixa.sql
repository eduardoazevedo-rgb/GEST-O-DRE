-- ============================================================
--  Fluxo de Caixa — Fase 1
--  Substitui a planilha "Fluxo de caixa HOFF": cada linha vira um lançamento com
--  parcelas datadas; as médias de clientes/fornecedores viram premissas mensais;
--  o fechamento do banco vira saldo real. Nada aqui lê o ERP.
--
--  Sinal: como na planilha — entrada positiva, saída negativa, gravado na parcela.
--
--  Acesso:
--   · ver e lançar  → módulo "fluxo_caixa" (usuario_modulos) + acesso à empresa;
--   · premissas e saldo real → só administradores, por enquanto.
--  As policies seguem o padrão da migração 024: funções sem argumento como
--  (select f()) e empresas permitidas por função security definer, para nada
--  ser avaliado linha a linha.
-- ============================================================

-- ---------- Blocos (a organização da grade) ----------
create table if not exists fc_blocos (
  id    text primary key,
  nome  text not null,
  ordem smallint not null
);

insert into fc_blocos (id, nome, ordem) values
  ('recebimentos',     'Recebimentos',              10),
  ('fornecedores',     'Fornecedores (média)',      20),
  ('estrategicos',     'Fornecedores estratégicos', 30),
  ('investimentos',    'Investimentos por unidade', 40),
  ('veiculos',         'Veículos',                  50),
  ('ssma',             'SSMA',                      60),
  ('seguros',          'Seguros',                   70),
  ('financiamentos',   'Financiamentos',            80),
  ('pessoal_tributos', 'Pessoal e tributos',        90)
on conflict (id) do update set nome = excluded.nome, ordem = excluded.ordem;

-- ---------- Lançamentos ----------
create table if not exists fc_lancamentos (
  id                  uuid primary key default uuid_generate_v4(),
  empresa_id          smallint not null references empresas(id),
  bloco_id            text     not null references fc_blocos(id),
  unidade             integer,                       -- cd_empresa da filial; null = corporativo
  descricao           text     not null,
  ano_projeto         integer,
  responsavel         text,
  status              text     not null default 'previsto'
                        check (status in ('previsto','aprovado','contratado','realizado','cancelado')),
  tipo                text     not null check (tipo in ('entrada','saida')),
  regra               text     not null default 'manual'
                        check (regra in ('avista','parcelado','entrada_parcelas','manual')),
  valor_total         numeric(15,2),                 -- positivo; o sinal vem do tipo
  primeiro_vencimento date,
  n_parcelas          integer check (n_parcelas is null or n_parcelas between 1 and 360),
  intervalo_meses     smallint not null default 1 check (intervalo_meses between 1 and 12),
  entrada_pct         numeric(5,2) check (entrada_pct is null or entrada_pct between 0 and 100),
  codigos_erp         text,
  observacao          text,
  origem              text,                          -- ex.: "Planilha 04.08.2026 · linha 40"
  criado_por          uuid default auth.uid(),
  criado_em           timestamptz not null default now(),
  atualizado_por      uuid default auth.uid(),
  atualizado_em       timestamptz not null default now()
);
create index if not exists idx_fc_lanc_empresa on fc_lancamentos (empresa_id, bloco_id);

create table if not exists fc_parcelas (
  id             uuid primary key default uuid_generate_v4(),
  lancamento_id  uuid not null references fc_lancamentos(id) on delete cascade,
  vencimento     date not null,
  valor          numeric(15,2) not null,             -- com sinal: + entrada, − saída
  ajustada       boolean not null default false      -- mexida à mão, fora da regra
);
create index if not exists idx_fc_parc_lanc on fc_parcelas (lancamento_id);
create index if not exists idx_fc_parc_venc on fc_parcelas (vencimento);

-- ---------- Premissas e saldo real ----------
create table if not exists fc_premissas (
  empresa_id     smallint not null references empresas(id),
  mes            date     not null check (extract(day from mes) = 1),
  tipo           text     not null check (tipo in ('clientes','fornecedores')),
  valor          numeric(15,2) not null,
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now(),
  primary key (empresa_id, mes, tipo)
);

create table if not exists fc_saldos_reais (
  empresa_id     smallint not null references empresas(id),
  mes            date     not null check (extract(day from mes) = 1),   -- saldo no FIM deste mês
  valor          numeric(15,2) not null,
  informado_por  uuid default auth.uid(),
  informado_em   timestamptz not null default now(),
  primary key (empresa_id, mes)
);

-- ---------- Permissões ----------
-- Empresas que o usuário alcança, resolvidas uma vez por consulta.
create or replace function public.fc_empresas_permitidas()
returns setof smallint language sql stable security definer set search_path = public as $$
  select e.id from empresas e where user_tem_empresa(e.id)
$$;

-- Lançamentos que o usuário alcança (base das policies de parcelas).
create or replace function public.fc_lancamentos_permitidos()
returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from fc_lancamentos l
   where user_tem_modulo('fluxo_caixa') and user_tem_empresa(l.empresa_id)
$$;

alter table fc_blocos       enable row level security;
alter table fc_lancamentos  enable row level security;
alter table fc_parcelas     enable row level security;
alter table fc_premissas    enable row level security;
alter table fc_saldos_reais enable row level security;

drop policy if exists "fc_blocos: leitura" on fc_blocos;
create policy "fc_blocos: leitura" on fc_blocos for select using ((select is_usuario_ativo()) or (select is_admin()));

-- Lançamentos: quem tem o módulo lê e escreve nas empresas que alcança.
drop policy if exists "fc_lanc: leitura" on fc_lancamentos;
drop policy if exists "fc_lanc: insert"  on fc_lancamentos;
drop policy if exists "fc_lanc: update"  on fc_lancamentos;
drop policy if exists "fc_lanc: delete"  on fc_lancamentos;
create policy "fc_lanc: leitura" on fc_lancamentos for select
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
create policy "fc_lanc: insert" on fc_lancamentos for insert
  with check ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
create policy "fc_lanc: update" on fc_lancamentos for update
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()))
  with check ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
create policy "fc_lanc: delete" on fc_lancamentos for delete
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));

drop policy if exists "fc_parc: leitura" on fc_parcelas;
drop policy if exists "fc_parc: escrita" on fc_parcelas;
create policy "fc_parc: leitura" on fc_parcelas for select
  using (lancamento_id in (select fc_lancamentos_permitidos()));
create policy "fc_parc: escrita" on fc_parcelas for all
  using (lancamento_id in (select fc_lancamentos_permitidos()))
  with check (lancamento_id in (select fc_lancamentos_permitidos()));

-- Premissas e saldo real: todos com o módulo leem; só admin grava.
drop policy if exists "fc_prem: leitura" on fc_premissas;
drop policy if exists "fc_prem: escrita" on fc_premissas;
create policy "fc_prem: leitura" on fc_premissas for select
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
create policy "fc_prem: escrita" on fc_premissas for all
  using ((select is_admin())) with check ((select is_admin()));

drop policy if exists "fc_saldo: leitura" on fc_saldos_reais;
drop policy if exists "fc_saldo: escrita" on fc_saldos_reais;
create policy "fc_saldo: leitura" on fc_saldos_reais for select
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
create policy "fc_saldo: escrita" on fc_saldos_reais for all
  using ((select is_admin())) with check ((select is_admin()));

-- ---------- Salvar lançamento + parcelas numa transação ----------
-- Roda com a permissão de quem chama (security invoker): as policies acima valem.
-- p_lancamento: campos do lançamento (com "id" para editar, sem "id" para criar).
-- p_parcelas:   [{ "vencimento": "2026-09-01", "valor": -37083.33, "ajustada": false }, ...]
create or replace function public.fc_salvar_lancamento(p_lancamento jsonb, p_parcelas jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p_lancamento->>'id', '')::uuid;
begin
  if v_id is null then
    insert into fc_lancamentos (
      empresa_id, bloco_id, unidade, descricao, ano_projeto, responsavel, status, tipo, regra,
      valor_total, primeiro_vencimento, n_parcelas, intervalo_meses, entrada_pct, codigos_erp, observacao, origem
    ) values (
      (p_lancamento->>'empresa_id')::smallint, p_lancamento->>'bloco_id', nullif(p_lancamento->>'unidade','')::integer,
      p_lancamento->>'descricao', nullif(p_lancamento->>'ano_projeto','')::integer, nullif(p_lancamento->>'responsavel',''),
      coalesce(p_lancamento->>'status','previsto'), p_lancamento->>'tipo', coalesce(p_lancamento->>'regra','manual'),
      nullif(p_lancamento->>'valor_total','')::numeric, nullif(p_lancamento->>'primeiro_vencimento','')::date,
      nullif(p_lancamento->>'n_parcelas','')::integer, coalesce(nullif(p_lancamento->>'intervalo_meses','')::smallint, 1),
      nullif(p_lancamento->>'entrada_pct','')::numeric, nullif(p_lancamento->>'codigos_erp',''),
      nullif(p_lancamento->>'observacao',''), nullif(p_lancamento->>'origem','')
    ) returning id into v_id;
  else
    update fc_lancamentos set
      bloco_id            = p_lancamento->>'bloco_id',
      unidade             = nullif(p_lancamento->>'unidade','')::integer,
      descricao           = p_lancamento->>'descricao',
      ano_projeto         = nullif(p_lancamento->>'ano_projeto','')::integer,
      responsavel         = nullif(p_lancamento->>'responsavel',''),
      status              = coalesce(p_lancamento->>'status','previsto'),
      tipo                = p_lancamento->>'tipo',
      regra               = coalesce(p_lancamento->>'regra','manual'),
      valor_total         = nullif(p_lancamento->>'valor_total','')::numeric,
      primeiro_vencimento = nullif(p_lancamento->>'primeiro_vencimento','')::date,
      n_parcelas          = nullif(p_lancamento->>'n_parcelas','')::integer,
      intervalo_meses     = coalesce(nullif(p_lancamento->>'intervalo_meses','')::smallint, 1),
      entrada_pct         = nullif(p_lancamento->>'entrada_pct','')::numeric,
      codigos_erp         = nullif(p_lancamento->>'codigos_erp',''),
      observacao          = nullif(p_lancamento->>'observacao',''),
      atualizado_por      = auth.uid(),
      atualizado_em       = now()
    where id = v_id;
    if not found then
      raise exception 'Lançamento não encontrado ou sem permissão';
    end if;
    delete from fc_parcelas where lancamento_id = v_id;
  end if;

  insert into fc_parcelas (lancamento_id, vencimento, valor, ajustada)
  select v_id, (p->>'vencimento')::date, (p->>'valor')::numeric, coalesce((p->>'ajustada')::boolean, false)
    from jsonb_array_elements(coalesce(p_parcelas, '[]'::jsonb)) p
   where coalesce((p->>'valor')::numeric, 0) <> 0;

  return v_id;
end;
$$;
