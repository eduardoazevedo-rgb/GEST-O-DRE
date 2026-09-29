-- Bloco próprio para os aluguéis prediais, entre Seguros e Financiamentos.
insert into fc_blocos (id, nome, ordem) values ('aluguel_predial', 'Aluguel predial', 75)
on conflict (id) do nothing;
