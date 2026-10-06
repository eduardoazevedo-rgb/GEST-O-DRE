-- ============================================================
--  Fluxo de Caixa — vínculo por grupo do ERP
--
--  Vincular 16 mil clientes um a um não faz sentido: um bloco pode adotar um
--  grupo inteiro do ERP. O que o grupo traz é o que sobra dele depois de tirar
--  quem já tem vínculo próprio (fornecedor da linha, códigos no ERP ou a
--  tabela fc_erp_vinculos), para nada contar duas vezes.
-- ============================================================

create table if not exists fc_erp_vinculos_grupo (
  empresa_id smallint not null references empresas(id),
  grupo      text     not null,   -- recebimentos, fornecedores, estrategicos, creditos, financiamentos, investimentos
  bloco_id   text     not null references fc_blocos(id),
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  primary key (empresa_id, grupo)
);

alter table fc_erp_vinculos_grupo enable row level security;
drop policy if exists "fc_vincg: leitura" on fc_erp_vinculos_grupo;
drop policy if exists "fc_vincg: escrita" on fc_erp_vinculos_grupo;
create policy "fc_vincg: leitura" on fc_erp_vinculos_grupo for select
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
create policy "fc_vincg: escrita" on fc_erp_vinculos_grupo for all
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()))
  with check ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));

-- Recebimento de título de venda vai direto para o bloco Recebimentos.
insert into fc_erp_vinculos_grupo (empresa_id, grupo, bloco_id) values (1, 'recebimentos', 'recebimentos')
on conflict (empresa_id, grupo) do update set bloco_id = excluded.bloco_id;

-- Quem já está coberto por uma regra de grupo sai da lista de "sem vínculo".
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
       and not exists (select 1 from fc_erp_vinculos_grupo vg where vg.empresa_id = p_empresa and vg.grupo = b.grupo)
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
