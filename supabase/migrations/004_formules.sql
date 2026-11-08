-- Wergui SN : formules (Petite officine / Officine), essai, abonnement, console d'administration.

-- ------------------------------------------------------------ abonnement
alter table public.pharmacies add column if not exists essai_fin date not null default (current_date + 30);
alter table public.pharmacies add column if not exists paye_jusqu date;

-- Le titulaire ne peut plus modifier lui-même sa formule ni son statut d'abonnement
revoke update on public.pharmacies from authenticated, anon;
grant update (nom, adresse, ville, telephone, whatsapp, message_ticket, reglages) on public.pharmacies to authenticated;

-- ------------------------------------------------------------ administrateurs Wergui SN
create table if not exists public.wergui_admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.wergui_admins enable row level security;   -- aucune règle : illisible depuis l'API
revoke all on public.wergui_admins from authenticated, anon;

create or replace function private.est_admin() returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from wergui_admins where user_id = auth.uid())
$$;
revoke all on function private.est_admin() from public, anon;
grant execute on function private.est_admin() to authenticated;

create or replace function public.suis_admin() returns boolean
language sql stable security definer set search_path = public, private as $$ select private.est_admin() $$;

-- Liste des pharmacies pour la console : informations d'abonnement et compteurs, jamais le détail du stock ou des ventes
create or replace function public.admin_pharmacies()
returns table (id uuid, nom text, ville text, telephone text, formule text, statut text, essai_fin date, paye_jusqu date,
               created_at timestamptz, titulaire text, membres bigint, produits bigint, ventes_30j bigint)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  return query
    select ph.id, ph.nom, ph.ville, ph.telephone, ph.formule, ph.statut, ph.essai_fin, ph.paye_jusqu, ph.created_at,
           (select m.nom from membres m where m.pharmacy_id = ph.id and m.role = 'titulaire' limit 1),
           (select count(*) from membres m where m.pharmacy_id = ph.id and m.actif),
           (select count(*) from produits pr where pr.pharmacy_id = ph.id),
           (select count(*) from ventes v where v.pharmacy_id = ph.id and v.created_at > now() - interval '30 days')
      from pharmacies ph order by ph.created_at desc;
end $$;

create or replace function public.admin_definir_abonnement(p uuid, p_formule text, p_statut text, p_paye_jusqu date)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  if p_formule not in ('petite','officine') or p_statut not in ('essai','actif','suspendu') then raise exception 'Valeur invalide'; end if;
  update pharmacies set formule = p_formule, statut = p_statut, paye_jusqu = p_paye_jusqu where id = p;
end $$;

-- ------------------------------------------------------------ limites des formules (appliquées par la base)
create or replace function private.droits_role(r text) returns jsonb language sql immutable as $$
  select case r
    when 'adjoint' then '{"dash":true,"achat":true,"remise":true,"per":true,"recep":true,"cmd":true,"inv":true,"prod":true,"fin":true}'::jsonb
    when 'vendeur' then '{"per":true,"recep":true}'::jsonb
    else '{}'::jsonb end
$$;

create or replace function private.verif_membre() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare f text; st text;
begin
  select formule, statut into f, st from pharmacies where id = new.pharmacy_id;
  if f = 'petite' and st <> 'essai' and new.role <> 'titulaire' then
    new.droits := private.droits_role(new.role);   -- droits personnalisés : formule Officine
    if new.actif and (select count(*) from membres m where m.pharmacy_id = new.pharmacy_id and m.actif
                      and m.role <> 'titulaire' and m.user_id <> new.user_id) >= 1 then
      raise exception 'La formule Petite officine permet un seul membre en plus du titulaire. Passez à la formule Officine pour une équipe illimitée.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists verif_membre on public.membres;
create trigger verif_membre before insert or update on public.membres for each row execute function private.verif_membre();

create or replace function private.verif_produit() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if (select formule = 'petite' and statut <> 'essai' from pharmacies where id = new.pharmacy_id)
     and (select count(*) from produits where pharmacy_id = new.pharmacy_id) >= 1500 then
    raise exception 'La formule Petite officine est limitée à 1 500 références. Passez à la formule Officine pour des références illimitées.';
  end if;
  return new;
end $$;
drop trigger if exists verif_produit on public.produits;
create trigger verif_produit before insert on public.produits for each row execute function private.verif_produit();

create or replace function private.verif_abonnement() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare ph record;
begin
  select formule, statut into ph from pharmacies where id = new.pharmacy_id;
  if ph.statut = 'suspendu' then raise exception 'Abonnement suspendu : contactez Wergui SN pour le réactiver.'; end if;
  if tg_table_name = 'ventes' then
    if new.mode = 'Assurance' and ph.formule = 'petite' and ph.statut <> 'essai' then
      raise exception 'Le tiers payant (IPM, mutuelles, CMU) fait partie de la formule Officine.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists verif_abonnement on public.ventes;
create trigger verif_abonnement before insert on public.ventes for each row execute function private.verif_abonnement();
drop trigger if exists verif_abonnement on public.commandes;
create trigger verif_abonnement before insert on public.commandes for each row execute function private.verif_abonnement();
drop trigger if exists verif_abonnement on public.mouvements;
create trigger verif_abonnement before insert on public.mouvements for each row execute function private.verif_abonnement();

revoke all on function public.suis_admin(), public.admin_pharmacies(), public.admin_definir_abonnement(uuid,text,text,date) from public, anon;
grant execute on function public.suis_admin(), public.admin_pharmacies(), public.admin_definir_abonnement(uuid,text,text,date) to authenticated;
