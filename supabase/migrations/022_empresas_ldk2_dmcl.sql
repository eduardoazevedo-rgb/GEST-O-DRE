-- ============================================================
--  Multiempresa: LDK2 (ERP 2000) e DMCL (ERP 4000)
--  Até aqui o portal só tinha a HOFF (empresa_id 1, filiais 1000–1024) porque a
--  sincronização excluía 2000/4000 na origem. As duas são matrizes próprias no
--  ERP (CNPJs separados, imobiliárias), então entram como EMPRESAS, não como
--  filiais da HOFF: DRE, orçamento e permissão próprios.
--
--  O plano gerencial e o de-para são por empresa, e as três usam o mesmo plano
--  contábil no ERP — então este script copia o plano/de-para da HOFF para elas.
--  Se o plano da HOFF mudar, replicar de novo (ver comentário no fim).
-- ============================================================

insert into empresas (id, codigo, nome) values
  (2, 'LDK2', 'LDK2 EMPREENDIMENTOS IMOBILIARIOS S.A.'),
  (3, 'DMCL', 'DMCL EMPREENDIMENTOS IMOBILIARIOS LTDA')
on conflict (id) do nothing;

insert into filiais (cd_empresa, empresa_id, nome) values
  (2000, 2, 'LDK2 EMPREENDIMENTOS IMOBILIARIOS S.A.'),
  (4000, 3, 'DMCL EMPREENDIMENTOS IMOBILIARIOS LTDA')
on conflict (cd_empresa) do update set empresa_id = excluded.empresa_id, nome = excluded.nome;

-- ------------------------------------------------------------
-- 1. Conta que faltava no plano gerencial: PIS sobre aluguéis.
--    (COFINS sobre aluguéis já existia em 3.1.3.08; receita de aluguéis em
--     3.1.1.03; água/esgoto, depreciações de AAP e sobras de caixa também.)
-- ------------------------------------------------------------
insert into plano_contas (empresa_id, codigo, nome, nivel, natureza, exibir_dre)
select 1, '3.1.3.09', 'PIS SOBRE ALUGUEIS DE IMOVEIS', 4, p.natureza, p.exibir_dre
  from plano_contas p where p.empresa_id = 1 and p.codigo = '3.1.3.08'
on conflict (empresa_id, codigo) do nothing;

insert into plano_contas (empresa_id, codigo, nome, nivel, natureza, exibir_dre)
select 1, '3.1.3.09.001', 'PIS - ALUGUEIS DE IMOVEIS', 5, p.natureza, p.exibir_dre
  from plano_contas p where p.empresa_id = 1 and p.codigo = '3.1.3.08.001'
on conflict (empresa_id, codigo) do nothing;

-- ------------------------------------------------------------
-- 2. De-para das 6 classificações do ERP que 2000/4000 usam e ainda não tinham
--    destino gerencial. As outras 38 já existiam (o plano contábil é o mesmo).
-- ------------------------------------------------------------
insert into de_para_contas (empresa_id, cd_classificacao_erp, codigo_gerencial) values
  (1, '3.1.1.03.001', '3.1.1.03.001'),  -- RECEITA BRUTA - ALUGUEIS DE IMOVEIS
  (1, '3.2.2.91.001', '3.1.3.09.001'),  -- PIS - ALUGUEIS  (conta criada acima)
  (1, '3.2.2.92.001', '3.1.3.08.001'),  -- COFINS - ALUGUEIS
  (1, '3.3.1.01.001', '3.5.1.01.001'),  -- SOBRAS DE CAIXA
  (1, '5.1.2.17.002', '3.4.2.17.002'),  -- AGUA E ESGOTO (ADM)
  (1, '5.1.2.18.003', '3.4.2.18.003')   -- DEPRECIACOES DE AJUSTES DE AVALIACAO PATRIMONIAL (ADM)
on conflict (empresa_id, cd_classificacao_erp) do nothing;

-- ------------------------------------------------------------
-- 3. Replica plano e de-para da HOFF para LDK2 e DMCL.
--    Rodar de novo (é idempotente) sempre que o plano da HOFF mudar.
-- ------------------------------------------------------------
insert into plano_contas (empresa_id, codigo, nome, nivel, natureza, exibir_dre)
select e.id, p.codigo, p.nome, p.nivel, p.natureza, p.exibir_dre
  from plano_contas p cross join (select unnest(array[2, 3]::smallint[]) as id) e
 where p.empresa_id = 1
on conflict (empresa_id, codigo) do nothing;

insert into de_para_contas (empresa_id, cd_classificacao_erp, codigo_gerencial)
select e.id, d.cd_classificacao_erp, d.codigo_gerencial
  from de_para_contas d cross join (select unnest(array[2, 3]::smallint[]) as id) e
 where d.empresa_id = 1
on conflict (empresa_id, cd_classificacao_erp) do nothing;
