-- ============================================================
--  Fluxo de Caixa — aba Realizado no formato da Visão
--
--  Meses nas colunas, grupos nas linhas; cada grupo abre nos clientes ou
--  fornecedores. A regra de agrupamento passa a viver numa função só
--  (fc_erp_base), usada pelo cruzamento e pela aba Realizado — as duas telas
--  não podem divergir.
--
--  Valor de cada mês na grade: meses passados = realizado (baixado no mês);
--  mês atual = realizado + em aberto do mês; meses futuros = em aberto (a vencer).
--  O que venceu em mês passado e segue em aberto vai para a coluna "em atraso".
-- ============================================================

create or replace function public.fc_erp_base(p_empresa smallint, p_de date, p_ate date)
returns table (mes date, situacao text, lado text, cd_tipoconta integer, cd_pessoa integer, qtd integer, valor numeric, grupo text)
language sql stable security invoker set search_path = public as $$
  with codigos as (
    select distinct x::integer as cd_pessoa
      from fc_lancamentos l
      cross join lateral regexp_split_to_table(coalesce(l.codigos_erp, ''), '[^0-9]+') x
     where l.empresa_id = p_empresa and l.bloco_id = 'estrategicos' and x <> ''
  )
  select r.mes, r.situacao, r.lado, r.cd_tipoconta, r.cd_pessoa, r.qtd, r.valor,
         case
           when r.cd_pessoa in (select cd_pessoa from codigos)
                and (r.lado = 'pagar' or r.cd_tipoconta in (24, 103)) then 'estrategicos'
           when r.lado = 'receber' then 'recebimentos'
           when r.cd_tipoconta in (18, 19, 41, 42, 43) then 'financiamentos'
           when r.cd_tipoconta = 34 then 'investimentos'
           else 'fornecedores'
         end
    from fc_erp_titulos_resumo r
   where r.empresa_id = p_empresa and r.mes between p_de and p_ate
$$;

create or replace function public.fc_cruzamento_erp(p_empresa smallint, p_de date, p_ate date)
returns table (mes date, grupo text, situacao text, qtd bigint, valor numeric)
language sql stable security invoker set search_path = public as $$
  select b.mes, b.grupo, b.situacao, sum(b.qtd)::bigint, sum(b.valor)
    from fc_erp_base(p_empresa, p_de, p_ate) b
   group by 1, 2, 3
$$;

-- A lista plana da versão anterior da aba sai de cena.
drop function if exists public.fc_erp_por_pessoa(smallint, text, date, date, text);

-- Clientes/fornecedores de um grupo (ou de todos, com p_grupo nulo — usado na
-- busca), dos maiores para os menores, paginados dentro de cada grupo.
-- Uma linha por pessoa, com os meses em jsonb ({"2026-01-01": valor}), para a
-- página caber no limite de linhas da API.
create or replace function public.fc_erp_grupo_pessoas(
  p_empresa smallint, p_de date, p_ate date,
  p_grupo text default null, p_busca text default null,
  p_limite integer default 30, p_offset integer default 0
)
returns table (grupo text, cd_pessoa integer, nome text, lado text,
               valores jsonb, qtds jsonb, atraso numeric, qtd_atraso bigint,
               posicao bigint, total_pessoas bigint)
language sql stable security invoker set search_path = public as $$
  with mes_atual as (
    select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as m
  ),
  base as (
    select b.grupo, b.cd_pessoa, b.lado, b.mes, b.valor, b.qtd,
           case when b.mes = a.m then 'grade'
                when b.mes < a.m and b.situacao = 'realizado' then 'grade'
                when b.mes > a.m and b.situacao = 'aberto' then 'grade'
                when b.mes < a.m and b.situacao = 'aberto' then 'atraso'
           end as destino
      from fc_erp_base(p_empresa, p_de, p_ate) b
      cross join mes_atual a
      left join fc_erp_pessoas n on n.cd_pessoa = b.cd_pessoa
     where (p_grupo is null or b.grupo = p_grupo)
       and (coalesce(p_busca, '') = '' or b.cd_pessoa::text = p_busca or n.nome ilike '%' || p_busca || '%')
  ),
  por_mes as (
    select grupo, cd_pessoa, lado, mes, destino, sum(valor) as valor, sum(qtd) as qtd
      from base
     where destino is not null
     group by 1, 2, 3, 4, 5
  ),
  por_pessoa as (
    select grupo, cd_pessoa, lado,
           coalesce(jsonb_object_agg(mes, valor) filter (where destino = 'grade'), '{}') as valores,
           coalesce(jsonb_object_agg(mes, qtd) filter (where destino = 'grade'), '{}') as qtds,
           coalesce(sum(valor) filter (where destino = 'atraso'), 0) as atraso,
           coalesce(sum(qtd) filter (where destino = 'atraso'), 0)::bigint as qtd_atraso,
           coalesce(sum(valor) filter (where destino = 'grade'), 0) as total
      from por_mes
     group by 1, 2, 3
  ),
  ordenado as (
    select p.*,
           row_number() over (partition by p.grupo order by abs(p.total) + abs(p.atraso) desc, p.cd_pessoa, p.lado) as posicao,
           count(*) over (partition by p.grupo) as total_pessoas
      from por_pessoa p
  )
  select o.grupo, o.cd_pessoa,
         case when o.cd_pessoa = 0 then '(sem cadastro)' else coalesce(n.nome, 'Pessoa ' || o.cd_pessoa) end,
         o.lado, o.valores, o.qtds, o.atraso, o.qtd_atraso, o.posicao, o.total_pessoas
    from ordenado o
    left join fc_erp_pessoas n on n.cd_pessoa = o.cd_pessoa
   where o.posicao > p_offset and o.posicao <= p_offset + p_limite
   order by o.grupo, o.posicao
$$;
