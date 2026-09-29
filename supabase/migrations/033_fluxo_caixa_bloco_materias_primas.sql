-- Bloco "Fornecedores estratégicos" passa a se chamar "Fornecedores matérias-primas".
-- O id do bloco continua 'estrategicos', então nada mais muda.
update fc_blocos set nome = 'Fornecedores matérias-primas' where id = 'estrategicos';
