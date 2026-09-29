-- ============================================================
--  Fluxo de Caixa — subgrupos dentro de Tributos
--
--  Pessoal fica só com o que é folha mesmo (folha, adiantamento, 13º,
--  rescisões). Tudo que é imposto ou encargo vai para Tributos, separado por
--  natureza — inclusive os encargos da folha (INSS, FGTS, IRRF), que ficam
--  mais lineares aqui do que dentro de Pessoal.
-- ============================================================

insert into fc_blocos (id, nome, ordem, pai_id) values
  ('tributos_folha',  'Encargos da folha (INSS, FGTS, IRRF)',        101, 'tributos'),
  ('tributos_vendas', 'Impostos sobre vendas (PIS, COFINS, ICMS)',   102, 'tributos'),
  ('tributos_lucro',  'Impostos sobre o lucro (IRPJ, CSLL, JCP)',    103, 'tributos'),
  ('tributos_taxas',  'Taxas e outros (IPTU, IPVA, alvarás)',        104, 'tributos')
on conflict (id) do nothing;

-- As duas linhas que já existiam vão para o subgrupo certo.
update fc_lancamentos set bloco_id = 'tributos_lucro'
 where empresa_id = 1 and bloco_id = 'tributos' and (descricao ilike '%jcp%' or descricao ilike '%irpj%' or descricao ilike '%csll%');

update fc_lancamentos set bloco_id = 'tributos_taxas'
 where empresa_id = 1 and bloco_id = 'tributos' and (descricao ilike '%iptu%' or descricao ilike '%ipva%');
