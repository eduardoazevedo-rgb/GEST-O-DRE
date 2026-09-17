-- ============================================================
--  Fluxo de Caixa × ERP — cruzar o controle manual com o sistema
--
--  Resumo dos títulos do ERP (tabela CONTAS), gravado pela sincronização local.
--  Mesma regra do relatório de fluxo de caixa do próprio ERP
--  (VIEW_FLUXOCAIXARFC010CC), validada contra a planilha em jul/26:
--    · a receber: TIPOCONTA.TP_TIPOCONTA em CR, CT, HR
--    · a pagar:   TIPOCONTA.TP_TIPOCONTA em CP, HP
--    · fora: incobráveis, adiantamentos (AC/AF), provisões (PP/PR), cancelados
--      e status A — origem de reparcelamento, já substituída por títulos novos
--    · realizado: status L, pelo mês de liquidação, valor do documento
--    · em aberto: status T/P, pelo mês de vencimento, saldo
--  Por enquanto só a renovadora (ERP 1000–1024 → empresa 1).
-- ============================================================

create table if not exists fc_erp_titulos_resumo (
  empresa_id      smallint not null references empresas(id),
  mes             date     not null check (extract(day from mes) = 1),
  situacao        text     not null check (situacao in ('realizado','aberto')),
  lado            text     not null check (lado in ('receber','pagar')),
  cd_tipoconta    integer  not null,
  cd_pessoa       integer  not null default 0,   -- 0 no lado receber, exceto créditos de fornecedor
  qtd             integer  not null,
  valor           numeric(15,2) not null,         -- com sinal: receber +, pagar −
  sincronizado_em timestamptz not null default now(),
  primary key (empresa_id, mes, situacao, lado, cd_tipoconta, cd_pessoa)
);

alter table fc_erp_titulos_resumo enable row level security;
drop policy if exists "fc_erp: leitura" on fc_erp_titulos_resumo;
create policy "fc_erp: leitura" on fc_erp_titulos_resumo for select
  using ((select user_tem_modulo('fluxo_caixa')) and empresa_id in (select fc_empresas_permitidas()));
-- Escrita só pela sincronização (conexão direta, fora do PostgREST).

-- ---------- Cruzamento por grupo ----------
-- Grupos (ligação com os blocos do controle manual):
--   estrategicos   → fornecedores cujos códigos estão nos lançamentos do bloco
--                    Estratégicos (campo "Códigos no ERP"): o que se paga a eles e
--                    os créditos que eles concedem (título a receber tipo 24/103),
--                    como o controle manual faz com "Créditos de banda/pneu"
--   recebimentos   → o restante a receber
--   financiamentos → empréstimos (18, 19) e consórcios (41, 42, 43)
--   investimentos  → contas a pagar imobilizado (34)
--   fornecedores   → o restante a pagar
-- Security invoker: a policy acima vale para quem chama.
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
           when r.cd_pessoa in (select cd_pessoa from codigos) then 'estrategicos'
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

-- Códigos do ERP que já estavam anotados na descrição das linhas importadas.
update fc_lancamentos set codigos_erp = '1059213, 1059214'
 where empresa_id = 1 and codigos_erp is null and descricao like 'Saídas Bandas (sistema) // 1059213 1059214%';
update fc_lancamentos set codigos_erp = '1059210'
 where empresa_id = 1 and codigos_erp is null and descricao like 'Saídas Pneus (sistema) // 1059210%';
