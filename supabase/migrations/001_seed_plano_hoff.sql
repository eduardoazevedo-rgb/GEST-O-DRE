-- ============================================================
--  Seed parcial do plano de contas gerencial HOFF
--  Extraído do relatório Power BI "DRE_PLANEJAMENTO VS REALIZADO".
--  O plano completo deve ser importado por planilha na tela
--  Plano de Contas (este seed garante a estrutura mínima).
-- ============================================================

insert into plano_contas (empresa_id, codigo, nome, nivel, natureza, exibir_dre)
values
  (1, '3.1',  'RECEITA LIQUIDA',                                   2,  1, true),
  (1, '3.3',  'CUSTO DAS VENDAS',                                  2, -1, true),
  (1, '3.4',  'DESPESAS COM VENDAS, GERAIS E ADMINISTRATIVAS',     2, -1, true),
  (1, '3.5',  'OUTRAS RECEITAS E DESPESAS OPERACIONAIS',           2, -1, true),
  (1, '3.7',  'RECEITAS E DESPESAS FINANCEIRAS',                   2, -1, true),
  (1, '3.9',  'IR E CS',                                           2, -1, true),
  (1, '3.10', 'IMPLANTACAO',                                       2, -1, false),

  (1, '3.3.3', 'ABSORCAO DE CUSTOS COM PRESTACAO DE SERVICOS',     3, -1, true),
  (1, '3.3.4', 'ACERTOS DE INVENTARIO',                            3, -1, true),
  (1, '3.4.1', 'DESPESAS COM VENDAS',                              3, -1, true),
  (1, '3.4.2', 'DESPESAS GERAIS E ADMINISTRATIVAS',                3, -1, true),
  (1, '3.9.1', 'IR E CS',                                          3, -1, true),

  (1, '3.3.3.04', 'OPERACAO (SERV)',                               4, -1, true),
  (1, '3.3.3.14', 'DESPESAS GERAIS (SERV)',                        4, -1, true),
  (1, '3.3.4.01', 'ACERTOS DE INVENTARIO DE MERCADORIAS VENDIDAS', 4, -1, true),
  (1, '3.9.1.01', 'IMPOSTO DE RENDA E CONTRIBUICAO SOCIAL CORRENTES', 4, -1, true),

  (1, '3.3.3.04.005', 'CONSUMO DE MATERIAIS DIRETOS (SERV)',                        5, -1, true),
  (1, '3.3.3.05.002', 'MANUTENCAO DE MAQUINAS, EQUIPAMENTOS E FERRAMENTAS (SERV)',  5, -1, true),
  (1, '3.3.3.10.002', 'ALUGUEL DE HARDWARES (SERV)',                                5, -1, true),
  (1, '3.3.3.10.003', 'MANUTENCAO DE HARDWARES (SERV)',                             5, -1, true),
  (1, '3.4.1.04.002', 'MANUTENCAO DE MAQUINAS, EQUIPAMENTOS E FERRAMENTAS (VEN)',   5, -1, true),
  (1, '3.4.1.08.001', 'COMBUSTIVEL DE VEICULOS (VEN)',                              5, -1, true),
  (1, '3.4.1.08.002', 'TELEMETRIA E REASTREAMENTO (VEN)',                           5, -1, true),
  (1, '3.4.1.08.006', 'MANUTENCAO CORRETIVA DE VEICULOS (VEN)',                     5, -1, true),
  (1, '3.4.1.08.012', 'FRETES SOBRE VENDAS (VEN)',                                  5, -1, true),
  (1, '3.4.1.10.002', 'ACOES E MATERIAIS DE PUBLICIDADE E PROPAGANDA (VEN)',        5, -1, true),
  (1, '3.4.1.11.001', 'SERVICOS SUBCONTRATADOS (VEN)',                              5, -1, true),
  (1, '3.4.1.14.006', 'EQUIPAMENTOS DE PROTECAO INDIVIDUAL (VEN)',                  5, -1, true),
  (1, '3.4.1.16.005', 'SERVICOS DE LIMPEZA (VEN)',                                  5, -1, true),
  (1, '3.4.1.16.010', 'MATERIAIS DE COPA E COZINHA (VEN)',                          5, -1, true),
  (1, '3.4.2.01.001', 'PRO LABORE (ADM)',                                           5, -1, true),
  (1, '3.4.2.05.001', 'MANUTENCAO DE PREDIOS E INSTALACOES (ADM)',                  5, -1, true),
  (1, '3.4.2.08.001', 'HOSPEDAGENS (ADM)',                                          5, -1, true),
  (1, '3.4.2.08.002', 'PASSAGENS E CONDUCOES (ADM)',                                5, -1, true),
  (1, '3.4.2.09.001', 'COMBUSTIVEL DE VEICULOS (ADM)',                              5, -1, true),
  (1, '3.4.2.10.004', 'HOSPEDAGEM E GESTAO DE INFRA DE TI (ADM)',                   5, -1, true),
  (1, '3.4.2.10.006', 'MANUTENCAO DE SOFTWARES (ADM)',                              5, -1, true),
  (1, '3.4.2.11.001', 'ACOES DE ENDOMARKETING E RESPONSABILIDADE SOCIAL (ADM)',     5, -1, true),
  (1, '3.4.2.13.001', 'SERVICOS DE RECRUTAMENTO E SELECAO DE PESSOAL (ADM)',        5, -1, true),
  (1, '3.4.2.17.004', 'CORREIOS E MALOTES (ADM)',                                   5, -1, true),
  (1, '3.4.2.17.008', 'BENS DE PEQUENO VALOR (ADM)',                                5, -1, true),
  (1, '3.7.1.02.007', 'DESCONTOS FINANCEIROS COMERCIAL BRIDGESTONE',                5,  1, true)
on conflict (empresa_id, codigo) do nothing;
