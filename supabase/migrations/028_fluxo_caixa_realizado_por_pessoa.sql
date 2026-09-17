-- ============================================================
--  Fluxo de Caixa — aba Realizado: clientes e fornecedores
--
--  O resumo fc_erp_titulos_resumo passa a guardar o cliente também no lado a
--  receber (antes só fornecedores e créditos de fornecedor), para listar quem
--  pagou, quem recebeu e quem ainda está em aberto. Os nomes vêm do cadastro
--  PESSOA do ERP, gravados pela mesma sincronização.
-- ============================================================

comment on column fc_erp_titulos_resumo.cd_pessoa is 'Cliente (receber) ou fornecedor (pagar) no ERP';

create table if not exists fc_erp_pessoas (
  cd_pessoa integer primary key,
  nome      text not null
);
alter table fc_erp_pessoas enable row level security;
drop policy if exists "fc_erp_pessoas: leitura" on fc_erp_pessoas;
create policy "fc_erp_pessoas: leitura" on fc_erp_pessoas for select
  using ((select user_tem_modulo('fluxo_caixa')));

-- Cruzamento: com o cliente agora gravado no lado receber, o código de um
-- fornecedor estratégico só pode puxar para Estratégicos o que é pago a ele ou
-- os créditos que ele concede (24/103) — não uma venda eventual para ele.
create or replace function public.fc_cruzamento_erp(p_empresa smallint, p_de date, p_ate date)
returns table (mes date, grupo text, situacao text, qtd bigint, valor numeric)
language sql stable security invoker set search_path = public as $$
  with codigos as (
    select distinct x::integer as cd_pessoa
      from fc_lancamentos l
      cross join lateral regexp_split_to_table(coalesce(l.codigos_erp, ''), '[^0-9]+') x
     where l.empresa_id = p_empresa and l.bloco_id = 'estrategicos' and x <> ''
  )
  select r.mes,
         case
           when r.cd_pessoa in (select cd_pessoa from codigos)
                and (r.lado = 'pagar' or r.cd_tipoconta in (24, 103)) then 'estrategicos'
           when r.lado = 'receber' then 'recebimentos'
           when r.cd_tipoconta in (18, 19, 41, 42, 43) then 'financiamentos'
           when r.cd_tipoconta = 34 then 'investimentos'
           else 'fornecedores'
         end as grupo,
         r.situacao,
         sum(r.qtd)::bigint,
         sum(r.valor)
    from fc_erp_titulos_resumo r
   where r.empresa_id = p_empresa and r.mes between p_de and p_ate
   group by 1, 2, 3
$$;

-- ---------- Aba Realizado ----------
-- Uma linha por pessoa (e grupo) no período:
--   realizado → pago/recebido no período (mês de liquidação)
--   vencido   → em aberto com vencimento no período e antes do mês atual
--   a_vencer  → em aberto com vencimento no período, do mês atual em diante
-- Cada linha traz também os totais de todas as linhas do filtro (window), para a
-- tela mostrar o resumo mesmo carregando só as primeiras pessoas.
create or replace function public.fc_erp_por_pessoa(
  p_empresa smallint, p_lado text, p_de date, p_ate date, p_busca text default null
)
returns table (
  cd_pessoa integer, nome text, grupo text,
  qtd_realizado bigint, realizado numeric,
  qtd_vencido bigint, vencido numeric,
  qtd_a_vencer bigint, a_vencer numeric,
  total_pessoas bigint, total_realizado numeric, total_vencido numeric, total_a_vencer numeric
)
language sql stable security invoker set search_path = public as $$
  with mes_atual as (
    select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as m
  ),
  codigos as (
    select distinct x::integer as cd_pessoa
      from fc_lancamentos l
      cross join lateral regexp_split_to_table(coalesce(l.codigos_erp, ''), '[^0-9]+') x
     where l.empresa_id = p_empresa and l.bloco_id = 'estrategicos' and x <> ''
  ),
  base as (
    select r.cd_pessoa,
           case
             when r.lado = 'receber' then
               case when r.cd_tipoconta in (24, 103) then 'Crédito de fornecedor'
                    when r.cd_tipoconta = 12 then 'Cartão (operadora)'
                    else 'Cliente' end
             when r.cd_pessoa in (select cd_pessoa from codigos) then 'Estratégico'
             when r.cd_tipoconta in (18, 19) then 'Empréstimo'
             when r.cd_tipoconta in (41, 42, 43) then 'Consórcio'
             when r.cd_tipoconta = 34 then 'Imobilizado'
             else 'Fornecedor'
           end as grupo,
           r.situacao, r.mes, r.qtd, r.valor
      from fc_erp_titulos_resumo r
     where r.empresa_id = p_empresa and r.lado = p_lado and r.mes between p_de and p_ate
  ),
  por_pessoa as (
    select b.cd_pessoa, coalesce(n.nome, 'Pessoa ' || b.cd_pessoa) as nome, b.grupo,
           sum(b.qtd)   filter (where b.situacao = 'realizado')                                        as qtd_realizado,
           sum(b.valor) filter (where b.situacao = 'realizado')                                        as realizado,
           sum(b.qtd)   filter (where b.situacao = 'aberto' and b.mes <  (select m from mes_atual))    as qtd_vencido,
           sum(b.valor) filter (where b.situacao = 'aberto' and b.mes <  (select m from mes_atual))    as vencido,
           sum(b.qtd)   filter (where b.situacao = 'aberto' and b.mes >= (select m from mes_atual))    as qtd_a_vencer,
           sum(b.valor) filter (where b.situacao = 'aberto' and b.mes >= (select m from mes_atual))    as a_vencer
      from base b
      left join fc_erp_pessoas n on n.cd_pessoa = b.cd_pessoa
     where p_busca is null or p_busca = ''
        or b.cd_pessoa::text = p_busca
        or n.nome ilike '%' || p_busca || '%'
     group by 1, 2, 3
  )
  select p.cd_pessoa, p.nome, p.grupo,
         coalesce(p.qtd_realizado, 0), coalesce(p.realizado, 0),
         coalesce(p.qtd_vencido, 0), coalesce(p.vencido, 0),
         coalesce(p.qtd_a_vencer, 0), coalesce(p.a_vencer, 0),
         count(*) over (),
         sum(coalesce(p.realizado, 0)) over (),
         sum(coalesce(p.vencido, 0)) over (),
         sum(coalesce(p.a_vencer, 0)) over ()
    from por_pessoa p
   order by abs(coalesce(p.realizado, 0)) + abs(coalesce(p.vencido, 0)) + abs(coalesce(p.a_vencer, 0)) desc, p.nome
$$;
