-- Contratos fica no mesmo nível de Benfeitoria, Veículos e SSMA: sub-bloco
-- direto de Investimentos, e não dentro da benfeitoria.
update fc_blocos set pai_id = 'investimentos', ordem = 43 where id = 'contratos';
