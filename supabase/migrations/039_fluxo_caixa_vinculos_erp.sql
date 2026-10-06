-- ============================================================
--  Fluxo de Caixa — vínculo fornecedor do ERP → bloco do previsto
--
--  O Previsto × Sistema passa a ter as mesmas linhas do fluxo próprio (a
--  árvore de blocos). O lado do sistema vem do que está vinculado: cada
--  fornecedor do ERP aponta um bloco, seja por esta tabela, seja pelo
--  fornecedor escolhido na linha do lançamento (fc_lancamentos.cd_pessoa).
--  O que ninguém reclamou fica na linha "sem vínculo".
-- ============================================================

create table if not exists fc_erp_vinculos (
  empresa_id smallint not null references empresas(id),
  cd_pessoa  integer  not null,
  bloco_id   text     not null references fc_blocos(id),
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  primary key (empresa_id, cd_pessoa)
);

alter table fc_erp_vinculos enable row level security;
drop policy if exists "fc_vinc: leitura" on fc_erp_vinculos;
drop policy if exists "fc_vinc: escrita" on fc_erp_vinculos;
create policy "fc_vinc: leitura" on fc_erp_vinculos for select
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
create policy "fc_vinc: escrita" on fc_erp_vinculos for all
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()))
  with check ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));

-- Fornecedores/clientes do ERP que ainda não apontam para nenhum bloco, dos
-- maiores para os menores, com os meses pela mesma regra do cruzamento.
create or replace function public.fc_erp_nao_vinculados(
  p_empresa smallint, p_de date, p_ate date, p_limite integer default 20, p_offset integer default 0
)
returns table (cd_pessoa integer, nome text, grupo text, valores jsonb, total numeric, posicao bigint, total_pessoas bigint)
language sql stable security invoker set search_path = public as $$
  with mes_atual as (
    select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as m
  ),
  ligados as (
    select cd_pessoa from fc_erp_vinculos where empresa_id = p_empresa
    union
    select cd_pessoa from fc_lancamentos where empresa_id = p_empresa and cd_pessoa is not null
    union
    -- códigos digitados no campo "Códigos no ERP" do lançamento
    select x::integer
      from fc_lancamentos l
      cross join lateral regexp_split_to_table(coalesce(l.codigos_erp, ''), '[^0-9]+') x
     where l.empresa_id = p_empresa and x <> ''
  ),
  base as (
    select b.cd_pessoa, b.grupo, b.mes, b.valor
      from fc_erp_base(p_empresa, p_de, p_ate) b, mes_atual a
     where not exists (select 1 from ligados g where g.cd_pessoa = b.cd_pessoa)
       and ((b.mes < a.m and b.situacao = 'realizado')
         or (b.mes > a.m and b.situacao = 'aberto')
         or  b.mes = a.m)
  ),
  por_mes as (select cd_pessoa, mes, sum(valor) as valor from base group by 1, 2),
  -- grupo em que a pessoa mais pesa, só para rotular a linha
  por_grupo as (
    select cd_pessoa, grupo, row_number() over (partition by cd_pessoa order by abs(sum(valor)) desc) as r
      from base group by 1, 2
  ),
  por_pessoa as (
    select cd_pessoa, jsonb_object_agg(mes, valor) as valores, sum(valor) as total
      from por_mes group by 1
  ),
  ordenado as (
    select p.cd_pessoa, p.valores, p.total, g.grupo,
           row_number() over (order by abs(p.total) desc, p.cd_pessoa) as posicao,
           count(*) over () as total_pessoas
      from por_pessoa p
      join por_grupo g on g.cd_pessoa = p.cd_pessoa and g.r = 1
  )
  select o.cd_pessoa,
         case when o.cd_pessoa = 0 then '(sem cadastro)' else coalesce(n.nome, 'Pessoa ' || o.cd_pessoa) end,
         o.grupo, o.valores, o.total, o.posicao, o.total_pessoas
    from ordenado o
    left join fc_erp_pessoas n on n.cd_pessoa = o.cd_pessoa
   where o.posicao > p_offset and o.posicao <= p_offset + p_limite
   order by o.posicao
$$;
