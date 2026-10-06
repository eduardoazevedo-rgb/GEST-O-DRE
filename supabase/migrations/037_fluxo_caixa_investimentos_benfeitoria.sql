-- ============================================================
--  Fluxo de Caixa — Investimentos > Benfeitoria > Contratos
--
--  O bloco passa a se chamar só "Investimentos" e ganha a benfeitoria dentro
--  dele; dentro da benfeitoria, os contratos. Depois disso a grade segue como
--  nos outros blocos: unidade, lançamento e fornecedor.
--  Veículos e SSMA continuam como sub-blocos de Investimentos.
-- ============================================================

update fc_blocos set nome = 'Investimentos' where id = 'investimentos';

insert into fc_blocos (id, nome, ordem, pai_id) values
  ('benfeitoria', 'Benfeitoria', 41, 'investimentos'),
  ('contratos',   'Contratos',   42, 'benfeitoria')
on conflict (id) do nothing;

-- O que estava direto em Investimentos é benfeitoria.
update fc_lancamentos set bloco_id = 'benfeitoria' where empresa_id = 1 and bloco_id = 'investimentos';
