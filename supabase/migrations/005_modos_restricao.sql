-- ============================================================
--  Modos de restrição por usuário
--  - restringe_empresas: se false, o usuário enxerga todas as empresas
--  - restringe_contas:   se false, o usuário enxerga todas as contas
--  Cada dimensão pode ser ligada/desligada de forma independente;
--  quando ligada, valem os vínculos de usuario_empresas / usuario_contas.
--  Admin continua vendo tudo, sempre.
-- ============================================================

alter table profiles
  add column if not exists restringe_empresas boolean not null default true,
  add column if not exists restringe_contas   boolean not null default true;

-- ============================================================
-- 1. Funções de modo (security definer: não sofrem RLS)
-- ============================================================
create or replace function user_restringe_empresas()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.restringe_empresas from profiles p where p.id = auth.uid()), true)
$$;

create or replace function user_restringe_contas()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.restringe_contas from profiles p where p.id = auth.uid()), true)
$$;

-- ============================================================
-- 2. Funções de acesso passam a respeitar o modo
-- ============================================================
create or replace function user_tem_empresa(p_empresa smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and (
    not user_restringe_empresas()
    or exists (
      select 1 from usuario_empresas
      where user_id = auth.uid() and empresa_id = p_empresa
    )
  ))
$$;

create or replace function user_tem_conta(p_empresa smallint, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and (
    not user_restringe_contas()
    or exists (
      select 1 from usuario_contas uc
      where uc.user_id = auth.uid() and uc.empresa_id = p_empresa
        and (p_codigo = uc.codigo or p_codigo like uc.codigo || '.%')
    )
  ))
$$;

create or replace function user_ve_conta(p_empresa smallint, p_codigo text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or (is_usuario_ativo() and (
    not user_restringe_contas()
    or exists (
      select 1 from usuario_contas uc
      where uc.user_id = auth.uid() and uc.empresa_id = p_empresa
        and (p_codigo = uc.codigo
          or p_codigo like uc.codigo || '.%'
          or uc.codigo like p_codigo || '.%')
    )
  ))
$$;

-- ============================================================
-- 3. Policies que dependiam do vínculo de conta para carregar a
--    empresa implicitamente agora conferem as duas dimensões.
-- ============================================================
drop policy if exists "de_para: leitura" on de_para_contas;
create policy "de_para: leitura" on de_para_contas for select
  using (is_admin() or (
    user_tem_empresa(empresa_id) and user_tem_conta(empresa_id, codigo_gerencial)
  ));

drop policy if exists "realizado: leitura" on realizado_erp;
create policy "realizado: leitura" on realizado_erp for select
  using (is_admin() or (
    user_tem_empresa(empresa_id) and exists (
      select 1 from de_para_contas d
      where d.empresa_id = realizado_erp.empresa_id
        and d.cd_classificacao_erp = realizado_erp.cd_classificacao_erp
        and user_tem_conta(d.empresa_id, d.codigo_gerencial)
    )
  ));

drop policy if exists "orc_valores: leitura" on orcamento_valores;
create policy "orc_valores: leitura" on orcamento_valores for select
  using (exists (select 1 from orcamento_versoes v
                 where v.id = versao_id
                   and user_tem_empresa(v.empresa_id)
                   and user_ve_conta(v.empresa_id, codigo_gerencial)));

drop policy if exists "orc_valores: insert" on orcamento_valores;
create policy "orc_valores: insert" on orcamento_valores for insert
  with check (exists (select 1 from orcamento_versoes v
                      where v.id = versao_id
                        and user_tem_empresa(v.empresa_id)
                        and user_tem_conta(v.empresa_id, codigo_gerencial)));

drop policy if exists "orc_valores: update" on orcamento_valores;
create policy "orc_valores: update" on orcamento_valores for update
  using (exists (select 1 from orcamento_versoes v
                 where v.id = versao_id
                   and user_tem_empresa(v.empresa_id)
                   and user_tem_conta(v.empresa_id, codigo_gerencial)));
