-- ============================================================
--  Fluxo de Caixa com acesso nominal
--
--  Até aqui administrador via todos os módulos automaticamente, e premissas e
--  saldo real do Fluxo de Caixa eram editáveis por qualquer administrador.
--  Como o portal tem mais de um administrador, isso liberava a aba para quem
--  não deveria ver. A regra pedida é: ninguém além do Eduardo vê a aba, e só
--  ele edita premissas e saldo real.
--
--  1. Módulos "explícitos": não vêm de brinde com o perfil de administrador;
--     precisam de linha em usuario_modulos até para admin. Hoje: fluxo_caixa.
--  2. Edição de premissas e saldo real vira permissão própria no profile
--     (edita_premissas_fc), independente de ser administrador.
-- ============================================================

create or replace function user_tem_modulo(p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select (is_admin() and p_modulo <> all (array['fluxo_caixa']))
      or (is_usuario_ativo() and exists (
            select 1 from usuario_modulos m where m.user_id = auth.uid() and m.modulo = p_modulo
          ))
$$;

alter table profiles add column if not exists edita_premissas_fc boolean not null default false;

create or replace function public.fc_edita_premissas()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.ativo and p.edita_premissas_fc from profiles p where p.id = auth.uid()), false)
$$;

drop policy if exists "fc_prem: escrita" on fc_premissas;
create policy "fc_prem: escrita" on fc_premissas for all
  using ((select fc_edita_premissas())) with check ((select fc_edita_premissas()));

drop policy if exists "fc_saldo: escrita" on fc_saldos_reais;
create policy "fc_saldo: escrita" on fc_saldos_reais for all
  using ((select fc_edita_premissas())) with check ((select fc_edita_premissas()));

-- Acesso concedido ao Eduardo (pelo login, que é estável).
insert into usuario_modulos (user_id, modulo)
select u.id, 'fluxo_caixa' from auth.users u where u.email = 'eduardobaggattini@gmail.com'
on conflict do nothing;

update profiles p set edita_premissas_fc = true
  from auth.users u
 where u.id = p.id and u.email = 'eduardobaggattini@gmail.com';
