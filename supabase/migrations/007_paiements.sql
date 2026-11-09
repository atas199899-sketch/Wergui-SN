-- Wergui SN : paiement de l'abonnement par Wave / Orange Money (version manuelle).
-- Le titulaire envoie le montant sur le numéro de Wergui SN puis déclare son paiement ;
-- un administrateur vérifie la réception et valide : l'abonnement est alors prolongé.

create table if not exists public.wergui_config (
  id int primary key default 1 check (id = 1),
  wave_numero text, om_numero text, beneficiaire text,
  modifie_le timestamptz not null default now()
);
insert into public.wergui_config (id) values (1) on conflict do nothing;
alter table public.wergui_config enable row level security;
create policy lire on public.wergui_config for select to authenticated using (true);
revoke insert, update, delete on public.wergui_config from authenticated, anon;
revoke all on public.wergui_config from anon;

create table if not exists public.paiements (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  formule text not null check (formule in ('petite','officine')),
  mois int not null check (mois in (1, 12)),
  montant int not null,
  moyen text not null check (moyen in ('Wave','Orange Money')),
  reference text check (length(reference) <= 80),
  declare_par uuid references auth.users on delete set null,
  declare_le timestamptz not null default now(),
  statut text not null default 'en_attente' check (statut in ('en_attente','valide','refuse')),
  traite_le timestamptz,
  note text check (length(note) <= 300),
  periode_fin date
);
create unique index if not exists paiements_un_en_attente on public.paiements (pharmacy_id) where statut = 'en_attente';
create index if not exists paiements_ph on public.paiements (pharmacy_id, declare_le desc);
alter table public.paiements enable row level security;
create policy lire on public.paiements for select to authenticated using (private.est_titulaire(pharmacy_id) or private.est_admin());
revoke insert, update, delete on public.paiements from authenticated, anon;
revoke all on public.paiements from anon;

create or replace function private.prix_formule(f text, m int) returns int language sql immutable as $$
  select (case f when 'officine' then 25000 else 15000 end) * (case when m = 12 then 10 else 1 end)
$$;

-- Le titulaire déclare avoir payé (montant calculé ici, jamais par l'application)
create or replace function public.declarer_paiement(p uuid, p_formule text, p_mois int, p_moyen text, p_reference text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v uuid;
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if p_formule not in ('petite','officine') or p_mois not in (1, 12) or p_moyen not in ('Wave','Orange Money') then raise exception 'Valeur invalide'; end if;
  if exists (select 1 from paiements where pharmacy_id = p and statut = 'en_attente') then
    raise exception 'Un paiement est déjà en cours de vérification. Wergui SN le valide en général le jour même.';
  end if;
  insert into paiements (pharmacy_id, formule, mois, montant, moyen, reference, declare_par)
  values (p, p_formule, p_mois, private.prix_formule(p_formule, p_mois), p_moyen, nullif(trim(left(coalesce(p_reference, ''), 80)), ''), auth.uid())
  returning id into v;
  return v;
end $$;

create or replace function public.annuler_paiement(p_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare r paiements;
begin
  select * into r from paiements where id = p_id;
  if not found or not est_titulaire(r.pharmacy_id) or r.statut <> 'en_attente' then raise exception 'Impossible d''annuler ce paiement'; end if;
  delete from paiements where id = p_id;
end $$;

-- Administrateur : valider (prolonge l'abonnement) ou refuser
create or replace function public.admin_traiter_paiement(p_id uuid, p_ok boolean, p_note text)
returns date language plpgsql security definer set search_path = public, private as $$
declare r paiements; ph pharmacies; fin date;
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  select * into r from paiements where id = p_id for update;
  if not found or r.statut <> 'en_attente' then raise exception 'Paiement déjà traité'; end if;
  if not p_ok then
    update paiements set statut = 'refuse', traite_le = now(), note = left(p_note, 300) where id = p_id;
    return null;
  end if;
  select * into ph from pharmacies where id = r.pharmacy_id for update;
  fin := (greatest(coalesce(ph.paye_jusqu, current_date), current_date) + make_interval(months => r.mois))::date;
  update pharmacies set formule = r.formule, statut = 'actif', paye_jusqu = fin where id = r.pharmacy_id;
  update paiements set statut = 'valide', traite_le = now(), note = left(p_note, 300), periode_fin = fin where id = p_id;
  return fin;
end $$;

create or replace function public.admin_config(p_wave text, p_om text, p_beneficiaire text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  update wergui_config set wave_numero = nullif(trim(p_wave), ''), om_numero = nullif(trim(p_om), ''),
    beneficiaire = nullif(trim(p_beneficiaire), ''), modifie_le = now() where id = 1;
end $$;

revoke all on function public.declarer_paiement(uuid,text,int,text,text), public.annuler_paiement(uuid),
  public.admin_traiter_paiement(uuid,boolean,text), public.admin_config(text,text,text), private.prix_formule(text,int) from public, anon;
grant execute on function public.declarer_paiement(uuid,text,int,text,text), public.annuler_paiement(uuid),
  public.admin_traiter_paiement(uuid,boolean,text), public.admin_config(text,text,text) to authenticated;
