-- ============================================================
--  Fluxo de Caixa — sub-blocos
--
--  Veículos e SSMA passam a viver dentro de "Investimentos por unidade",
--  como subtítulos: o bloco pai soma os dois, e cada um abre nos seus itens.
--  Os lançamentos não mudam de bloco — só ganham um nível acima.
-- ============================================================

alter table fc_blocos add column if not exists pai_id text references fc_blocos(id);
comment on column fc_blocos.pai_id is 'Bloco pai; nulo = bloco de primeiro nível';

update fc_blocos set pai_id = 'investimentos' where id in ('veiculos', 'ssma');
