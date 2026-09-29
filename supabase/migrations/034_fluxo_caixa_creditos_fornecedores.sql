-- ============================================================
--  Fluxo de Caixa — bloco "Créditos de fornecedores"
--
--  Os créditos que os fornecedores de matéria-prima concedem (banda, pneu)
--  saem do bloco de matérias-primas e ganham bloco próprio: lá só ficam as
--  saídas. No ERP a divisão é a mesma — crédito é título a receber tipo 24/103
--  de um fornecedor com código apontado nos lançamentos.
-- ============================================================

insert into fc_blocos (id, nome, ordem) values ('creditos_fornecedores', 'Créditos de fornecedores', 35)
on conflict (id) do nothing;

update fc_lancamentos set bloco_id = 'creditos_fornecedores'
 where empresa_id = 1 and bloco_id = 'estrategicos'
   and (tipo = 'entrada' or descricao ilike '%crédit%' or descricao ilike '%credit%');

create or replace function public.fc_erp_base(p_empresa smallint, p_de date, p_ate date)
returns table (mes date, situacao text, lado text, cd_tipoconta integer, cd_pessoa integer, qtd integer, valor numeric, grupo text)
language sql stable security invoker set search_path = public as $$
  with codigos as (
    select distinct x::integer as cd_pessoa
      from fc_lancamentos l
      cross join lateral regexp_split_to_table(coalesce(l.codigos_erp, ''), '[^0-9]+') x
     where l.empresa_id = p_empresa and l.bloco_id in ('estrategicos', 'creditos_fornecedores') and x <> ''
  )
  select r.mes, r.situacao, r.lado, r.cd_tipoconta, r.cd_pessoa, r.qtd, r.valor,
         case
           when r.cd_pessoa in (select cd_pessoa from codigos)
                and r.lado = 'receber' and r.cd_tipoconta in (24, 103) then 'creditos'
           when r.cd_pessoa in (select cd_pessoa from codigos) and r.lado = 'pagar' then 'estrategicos'
           when r.lado = 'receber' then 'recebimentos'
           when r.cd_tipoconta in (18, 19, 41, 42, 43) then 'financiamentos'
           when r.cd_tipoconta = 34 then 'investimentos'
           else 'fornecedores'
         end
    from fc_erp_titulos_resumo r
   where r.empresa_id = p_empresa and r.mes between p_de and p_ate
$$;
