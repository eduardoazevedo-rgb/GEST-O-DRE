# Portal Hoff Controladoria — Planejado vs Realizado

Substitui o relatório Power BI "DRE_PLANEJAMENTO VS REALIZADO" por um app web
(Next.js + Supabase), com o realizado sincronizado do ERP (Firebird) e o
orçamento importado/editado no próprio sistema.

## Arquitetura

- **Realizado**: job de sincronização lê o banco contábil do ERP
  (`192.168.1.31:/opt/firebird/databases/HOFF50.FDB`, **somente leitura**) e grava
  agregado por mês × conta × filial na tabela `realizado_erp` do Supabase.
  Como o Firebird é rede interna, a sincronização roda em uma máquina da empresa
  (`npm run sync`), não na Vercel.
- **Plano de contas gerencial** (níveis N2–N5 do DRE): importado por planilha na
  tela *Plano de Contas*. O vínculo com as contas contábeis do ERP é feito pela
  tabela de **de-para** (também importável, ou mapeando conta a conta na tela).
- **Orçamento (planejado)**: versões por ano; valores importados por planilha ou
  digitados na grade da tela *Orçamento*. A versão marcada como **ativa** é a
  usada no DRE.
- **DRE**: matriz por mês com modos Planejado vs Realizado, Realizado,
  Planejado e Desvio %, hierarquia expansível (N2 → N5) e linha de RESULTADO.

## Primeira configuração

1. Crie um projeto no [Supabase](https://supabase.com/dashboard) e preencha o
   `.env.local` (copie de `.env.example`).
2. Rode as migrations de `supabase/migrations/` (SQL Editor do painel, na ordem
   000 → 002).
3. Crie o primeiro usuário em Authentication → Users e promova a admin:
   `update profiles set role = 'admin' where id = '<user-id>';`
4. `npm install` e `npm run dev`.
5. Importe o plano de contas gerencial e o de-para na tela *Plano de Contas*
   (planilhas com colunas `CODIGO`/`NOME` e `CLASSIFICACAO_ERP`/`CODIGO_GERENCIAL`).
6. Sincronize o realizado: botão na tela *Sincronização* (rodando na rede da
   empresa) ou `npm run sync -- 2026`.
7. Crie a versão do orçamento na tela *Orçamento* e importe/edite os valores.

## Sincronização agendada (Windows)

Agendador de Tarefas → nova tarefa diária chamando:

```
cmd /c "cd /d C:\Users\Administrator\Documents\GESTAO-DRE && npm run sync"
```

## Convenção de sinais

Tudo segue o sinal contábil do ERP: **receitas positivas, despesas negativas**
(crédito − débito). O orçamento deve ser lançado com a mesma convenção.
O desvio favorável é sempre `realizado − planejado > 0`.

## Pendências conhecidas

- A consulta padrão do realizado usa `movtocontabil` (classes 3.x–6.x, excluindo
  filiais 2000/4000 e `tp_docto = 'A'`). Se o Power BI usava outra consulta
  (query `F_CUSTOS`), ajustar em `src/lib/dre/sync.ts` **e** em
  `scripts/sync-erp.mjs`.
- Multiempresa: além da HOFF (`empresa_id 1`, filiais 1000–1024), o portal tem a
  **LDK2** (ERP 2000) e a **DMCL** (ERP 4000) — imobiliárias, matrizes próprias no
  ERP. A empresa é escolhida no seletor do topo e vale para todas as telas.
  Cada uma tem plano de contas, de-para, orçamento e permissões próprios; o plano
  é uma cópia do da HOFF (ver `022_empresas_ldk2_dmcl.sql` para replicar de novo
  quando o plano mudar). Custo de Viagens e Auditoria seguem sendo da HOFF.
