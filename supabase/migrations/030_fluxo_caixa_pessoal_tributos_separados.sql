-- ============================================================
--  Fluxo de Caixa — "Pessoal e tributos" vira dois blocos
--
--  Pessoal  → folha, décimo terceiro, rescisões
--  Tributos → impostos e taxas (IRPJ/CSLL, IPTU, IPVA, JCP)
-- ============================================================

insert into fc_blocos (id, nome, ordem) values
  ('pessoal',  'Pessoal',  90),
  ('tributos', 'Tributos', 100)
on conflict (id) do nothing;

update fc_lancamentos set bloco_id = 'tributos'
 where bloco_id = 'pessoal_tributos'
   and (descricao ilike '%imposto%' or descricao ilike '%tribut%' or descricao ilike '%iptu%'
     or descricao ilike '%ipva%'    or descricao ilike '%irpj%'   or descricao ilike '%csll%');

update fc_lancamentos set bloco_id = 'pessoal' where bloco_id = 'pessoal_tributos';

delete from fc_blocos where id = 'pessoal_tributos';
