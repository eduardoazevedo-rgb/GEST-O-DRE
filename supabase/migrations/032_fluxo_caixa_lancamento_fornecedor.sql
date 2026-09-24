-- ============================================================
--  Fluxo de Caixa — fornecedor (ou cliente) na linha do previsto
--
--  Cada lançamento pode apontar a pessoa do ERP a que se refere. Com isso o
--  Previsto × Sistema cruza nome a nome: a previsão da linha de um lado, os
--  títulos daquele fornecedor do outro.
-- ============================================================

alter table fc_lancamentos add column if not exists cd_pessoa integer;
comment on column fc_lancamentos.cd_pessoa is 'Fornecedor/cliente no ERP (PESSOA.CD_PESSOA), para cruzar previsto × realizado';

create index if not exists fc_lancamentos_pessoa_idx on fc_lancamentos (empresa_id, cd_pessoa) where cd_pessoa is not null;

-- Busca de fornecedores para o formulário: nome ou código, os com mais
-- movimento primeiro. Security invoker: vale a policy de leitura do módulo.
create or replace function public.fc_buscar_pessoas(p_busca text, p_limite integer default 20)
returns table (cd_pessoa integer, nome text, titulos bigint, valor numeric)
language sql stable security invoker set search_path = public as $$
  select n.cd_pessoa, n.nome,
         coalesce(sum(r.qtd), 0)::bigint, coalesce(sum(r.valor), 0)
    from fc_erp_pessoas n
    left join fc_erp_titulos_resumo r on r.cd_pessoa = n.cd_pessoa
   where coalesce(p_busca, '') = '' or n.cd_pessoa::text = p_busca or n.nome ilike '%' || p_busca || '%'
   group by 1, 2
   order by count(r.*) desc, n.nome
   limit greatest(1, least(coalesce(p_limite, 20), 50))
$$;

-- A busca de pessoas de um grupo ganha um filtro por códigos: o cruzamento
-- precisa dos fornecedores que têm linha no previsto, mesmo que sejam pequenos
-- e não apareçam entre os maiores do grupo.
drop function if exists public.fc_erp_grupo_pessoas(smallint, date, date, text, text, integer, integer);

create or replace function public.fc_erp_grupo_pessoas(
  p_empresa smallint, p_de date, p_ate date,
  p_grupo text default null, p_busca text default null,
  p_limite integer default 30, p_offset integer default 0,
  p_pessoas integer[] default null
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
       and (p_pessoas is null or b.cd_pessoa = any (p_pessoas))
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

create or replace function public.fc_salvar_lancamento(p_lancamento jsonb, p_parcelas jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p_lancamento->>'id', '')::uuid;
begin
  if v_id is null then
    insert into fc_lancamentos (
      empresa_id, bloco_id, unidade, descricao, ano_projeto, responsavel, status, tipo, regra,
      valor_total, primeiro_vencimento, n_parcelas, intervalo_meses, entrada_pct, codigos_erp, cd_pessoa, observacao, origem
    ) values (
      (p_lancamento->>'empresa_id')::smallint, p_lancamento->>'bloco_id', nullif(p_lancamento->>'unidade','')::integer,
      p_lancamento->>'descricao', nullif(p_lancamento->>'ano_projeto','')::integer, nullif(p_lancamento->>'responsavel',''),
      coalesce(p_lancamento->>'status','previsto'), p_lancamento->>'tipo', coalesce(p_lancamento->>'regra','manual'),
      nullif(p_lancamento->>'valor_total','')::numeric, nullif(p_lancamento->>'primeiro_vencimento','')::date,
      nullif(p_lancamento->>'n_parcelas','')::integer, coalesce(nullif(p_lancamento->>'intervalo_meses','')::smallint, 1),
      nullif(p_lancamento->>'entrada_pct','')::numeric, nullif(p_lancamento->>'codigos_erp',''),
      nullif(p_lancamento->>'cd_pessoa','')::integer,
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
      cd_pessoa           = nullif(p_lancamento->>'cd_pessoa','')::integer,
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
