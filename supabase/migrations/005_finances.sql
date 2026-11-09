-- Wergui SN : module Finances (formule Officine et période d'essai)
-- Caisse du jour avec clôture « à l'aveugle », dépenses, créances des assurances (bordereaux),
-- factures des grossistes et avoirs, résultat du mois.

create or replace function private.premium(p uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select formule = 'officine' or statut = 'essai' from pharmacies where id = p
$$;

-- ------------------------------------------------------------ tables
create table public.caisses (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  fond int not null check (fond >= 0),
  ouverte_par uuid references auth.users on delete set null,
  ouverte_le timestamptz not null default now(),
  fermee_par uuid references auth.users on delete set null,
  fermee_le timestamptz,
  attendu int, compte int, ecart int,
  statut text not null default 'ouverte' check (statut in ('ouverte','fermee'))
);
create unique index caisses_une_ouverte on public.caisses (pharmacy_id) where statut = 'ouverte';
create index on public.caisses (pharmacy_id, ouverte_le desc);

create table public.depenses (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  date_depense date not null default current_date,
  libelle text not null check (length(trim(libelle)) between 1 and 160),
  categorie text not null default 'Autre',
  montant int not null check (montant > 0),
  mode text not null default 'Espèces caisse' check (mode in ('Espèces caisse','Wave','Orange Money','Banque','Chèque')),
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index on public.depenses (pharmacy_id, date_depense desc);

create table public.bordereaux (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  numero serial,
  organisme text not null,
  montant int not null,
  paye int not null default 0,
  envoye_le date,
  created_at timestamptz not null default now()
);
alter table public.ventes add column if not exists bordereau_id uuid references public.bordereaux on delete set null;

create table public.factures (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  fournisseur_id uuid references public.fournisseurs on delete set null,
  numero text,
  date_facture date not null default current_date,
  echeance date not null default (current_date + 30),
  montant int not null check (montant >= 0),
  paye int not null default 0,
  avoir_utilise int not null default 0,
  commande_id uuid references public.commandes on delete set null,
  created_at timestamptz not null default now()
);
create index on public.factures (pharmacy_id, echeance);

alter table public.caisses enable row level security;
alter table public.depenses enable row level security;
alter table public.bordereaux enable row level security;
alter table public.factures enable row level security;

-- Lecture : droit « Finances » ; la caisse ouverte est visible de toute l'équipe (sans montants attendus)
create policy lire on public.caisses for select to authenticated
  using (private.a_droit(pharmacy_id,'fin') or (statut = 'ouverte' and private.est_membre(pharmacy_id)));
create policy lire on public.depenses for select to authenticated using (private.a_droit(pharmacy_id,'fin'));
create policy ecrire on public.depenses for all to authenticated
  using (private.a_droit(pharmacy_id,'fin') and private.premium(pharmacy_id)) with check (private.a_droit(pharmacy_id,'fin') and private.premium(pharmacy_id));
create policy lire on public.bordereaux for select to authenticated using (private.a_droit(pharmacy_id,'fin'));
create policy lire on public.factures for select to authenticated using (private.a_droit(pharmacy_id,'fin'));
create policy ecrire on public.factures for insert to authenticated with check (private.a_droit(pharmacy_id,'fin') and private.premium(pharmacy_id));
create policy modifier on public.factures for update to authenticated
  using (private.a_droit(pharmacy_id,'fin') and private.premium(pharmacy_id)) with check (private.a_droit(pharmacy_id,'fin') and private.premium(pharmacy_id));
create policy supprimer on public.factures for delete to authenticated using (private.a_droit(pharmacy_id,'fin') and paye = 0);
revoke insert, update, delete on public.caisses, public.bordereaux from authenticated, anon;
revoke all on public.caisses, public.depenses, public.bordereaux, public.factures from anon;

-- ------------------------------------------------------------ caisse du jour
create or replace function public.ouvrir_caisse(p uuid, p_fond int)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v uuid;
begin
  if not est_membre(p) then raise exception 'Accès refusé'; end if;
  if not private.premium(p) then raise exception 'La gestion de caisse fait partie de la formule Officine.'; end if;
  if exists (select 1 from caisses where pharmacy_id = p and statut = 'ouverte') then raise exception 'La caisse est déjà ouverte'; end if;
  insert into caisses (pharmacy_id, fond, ouverte_par) values (p, greatest(coalesce(p_fond,0),0), auth.uid()) returning id into v;
  return v;
end $$;

-- Espèces attendues dans le tiroir depuis l'ouverture
create or replace function private.especes_attendues(c uuid) returns int
language sql stable security definer set search_path = public, private as $$
  select ca.fond
    + coalesce((select sum(case when v.mode = 'Espèces' then v.total when v.mode = 'Assurance' then v.total - v.part_assurance else 0 end)
                from ventes v where v.pharmacy_id = ca.pharmacy_id and v.created_at >= ca.ouverte_le), 0)
    - coalesce((select sum(d.montant) from depenses d where d.pharmacy_id = ca.pharmacy_id and d.mode = 'Espèces caisse'
                and d.created_at >= ca.ouverte_le), 0)
  from caisses ca where ca.id = c
$$;

create or replace function public.caisse_attendue(p uuid) returns int
language plpgsql stable security definer set search_path = public, private as $$
declare c uuid;
begin
  if not a_droit(p,'fin') then return null; end if;   -- clôture à l'aveugle pour les autres
  select id into c from caisses where pharmacy_id = p and statut = 'ouverte';
  return case when c is null then null else private.especes_attendues(c) end;
end $$;

-- Clôture : la personne saisit ce qu'elle a compté ; l'écart n'est renvoyé qu'avec le droit « Finances »
create or replace function public.fermer_caisse(p uuid, p_compte int)
returns int language plpgsql security definer set search_path = public, private as $$
declare c uuid; v_att int;
begin
  if not est_membre(p) then raise exception 'Accès refusé'; end if;
  if p_compte is null or p_compte < 0 then raise exception 'Montant compté invalide'; end if;
  select id into c from caisses where pharmacy_id = p and statut = 'ouverte' for update;
  if c is null then raise exception 'Aucune caisse ouverte'; end if;
  v_att := private.especes_attendues(c);
  update caisses set statut = 'fermee', fermee_par = auth.uid(), fermee_le = now(), attendu = v_att, compte = p_compte, ecart = p_compte - v_att where id = c;
  return case when a_droit(p,'fin') then p_compte - v_att else null end;
end $$;

-- ------------------------------------------------------------ assurances
create or replace function public.creer_bordereau(p uuid, p_organisme text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare v uuid; m int;
begin
  if not a_droit(p,'fin') then raise exception 'Droit « Finances » requis'; end if;
  if not private.premium(p) then raise exception 'Le suivi des assurances fait partie de la formule Officine.'; end if;
  select coalesce(sum(part_assurance),0) into m from ventes
   where pharmacy_id = p and organisme = p_organisme and part_assurance > 0 and bordereau_id is null;
  if m = 0 then raise exception 'Aucune vente à facturer pour cet organisme'; end if;
  insert into bordereaux (pharmacy_id, organisme, montant) values (p, p_organisme, m) returning id into v;
  update ventes set bordereau_id = v where pharmacy_id = p and organisme = p_organisme and part_assurance > 0 and bordereau_id is null;
  return v;
end $$;

create or replace function public.maj_bordereau(b uuid, p_envoye date, p_encaisse int)
returns void language plpgsql security definer set search_path = public, private as $$
declare r record;
begin
  select * into r from bordereaux where id = b;
  if not found or not a_droit(r.pharmacy_id,'fin') then raise exception 'Droit « Finances » requis'; end if;
  if p_encaisse is not null and (p_encaisse < 0 or r.paye + p_encaisse > r.montant) then raise exception 'Montant encaissé invalide'; end if;
  update bordereaux set envoye_le = coalesce(p_envoye, envoye_le), paye = paye + coalesce(p_encaisse,0) where id = b;
end $$;

-- ------------------------------------------------------------ grossistes : avoirs et paiements
create or replace function public.avoirs_grossistes(p uuid)
returns table (fournisseur_id uuid, retours int, utilises int, disponible int)
language sql stable security definer set search_path = public, private as $$
  with r as (select pr.fournisseur_id f, sum(m.valeur)::int v from mouvements m join produits pr on pr.id = m.produit_id
             where m.pharmacy_id = p and m.type = 'retour' group by 1),
       u as (select fournisseur_id f, sum(avoir_utilise)::int v from factures where pharmacy_id = p group by 1)
  select f.id, coalesce(r.v,0), coalesce(u.v,0), coalesce(r.v,0) - coalesce(u.v,0)
    from fournisseurs f left join r on r.f = f.id left join u on u.f = f.id
   where f.pharmacy_id = p and a_droit(p,'fin')
$$;

create or replace function public.payer_facture(f uuid, p_montant int, p_avoir int)
returns void language plpgsql security definer set search_path = public, private as $$
declare r record; dispo int;
begin
  select * into r from factures where id = f for update;
  if not found or not a_droit(r.pharmacy_id,'fin') then raise exception 'Droit « Finances » requis'; end if;
  p_montant := coalesce(p_montant,0); p_avoir := coalesce(p_avoir,0);
  if p_montant < 0 or p_avoir < 0 or r.paye + p_montant + p_avoir > r.montant then raise exception 'Montant invalide : il dépasse le reste à payer'; end if;
  select disponible into dispo from avoirs_grossistes(r.pharmacy_id) where fournisseur_id = r.fournisseur_id;
  if p_avoir > coalesce(dispo,0) then raise exception 'Avoir disponible insuffisant'; end if;
  update factures set paye = paye + p_montant + p_avoir, avoir_utilise = avoir_utilise + p_avoir where id = f;
end $$;

-- Chaque réception de commande crée la facture correspondante (au prix d'achat)
create or replace function public.receptionner_commande(p_commande uuid, p_lignes jsonb)
returns int language plpgsql security definer set search_path = public, private as $$
declare v_c record; v_l jsonb; v_n int := 0; v_m int := 0;
begin
  select * into v_c from commandes where id = p_commande;
  if not found then raise exception 'Commande inconnue'; end if;
  if not a_droit(v_c.pharmacy_id,'recep') then raise exception 'Droit « Réceptions » requis'; end if;
  if v_c.statut <> 'envoyee' then raise exception 'Commande déjà traitée'; end if;
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    if coalesce((v_l->>'quantite')::int,0) > 0 then
      perform ajouter_lot(v_c.pharmacy_id, (v_l->>'produit_id')::uuid, v_l->>'numero', (v_l->>'peremption')::date, (v_l->>'quantite')::int);
      v_n := v_n + (v_l->>'quantite')::int;
      v_m := v_m + (v_l->>'quantite')::int * coalesce((select prix_achat from produits where id = (v_l->>'produit_id')::uuid), 0);
    end if;
  end loop;
  update commandes set statut = 'recue', recue_at = now() where id = p_commande;
  if v_m > 0 then
    insert into factures (pharmacy_id, fournisseur_id, numero, montant, commande_id)
    values (v_c.pharmacy_id, v_c.fournisseur_id, 'BC-' || v_c.numero, v_m, p_commande);
  end if;
  return v_n;
end $$;

-- ------------------------------------------------------------ résultat du mois
create or replace function public.resultat_mois(p uuid, p_debut date)
returns table (ventes bigint, achats bigint, pertes bigint, retours bigint, depenses bigint, marge bigint, resultat bigint)
language plpgsql stable security definer set search_path = public, private as $$
declare d0 timestamptz := date_trunc('month', p_debut::timestamp); d1 timestamptz := d0 + interval '1 month';
  v bigint; a bigint; pe bigint; re bigint; de bigint;
begin
  if not a_droit(p,'fin') then raise exception 'Droit « Finances » requis'; end if;
  select coalesce(sum(total),0) into v from public.ventes where pharmacy_id = p and created_at >= d0 and created_at < d1;
  select coalesce(sum(l.quantite * l.prix_achat),0) into a from vente_lignes l join public.ventes x on x.id = l.vente_id
   where x.pharmacy_id = p and x.created_at >= d0 and x.created_at < d1;
  select coalesce(sum(valeur) filter (where type = 'retrait'),0), coalesce(sum(valeur) filter (where type = 'retour'),0) into pe, re
    from mouvements where pharmacy_id = p and created_at >= d0 and created_at < d1;
  select coalesce(sum(montant),0) into de from public.depenses where pharmacy_id = p and date_depense >= d0::date and date_depense < d1::date;
  return query select v, a, pe, re, de, v - a, v - a - pe - de;
end $$;

revoke all on function public.ouvrir_caisse(uuid,int), public.caisse_attendue(uuid), public.fermer_caisse(uuid,int),
  public.creer_bordereau(uuid,text), public.maj_bordereau(uuid,date,int), public.avoirs_grossistes(uuid),
  public.payer_facture(uuid,int,int), public.resultat_mois(uuid,date), private.premium(uuid), private.especes_attendues(uuid) from public, anon;
grant execute on function public.ouvrir_caisse(uuid,int), public.caisse_attendue(uuid), public.fermer_caisse(uuid,int),
  public.creer_bordereau(uuid,text), public.maj_bordereau(uuid,date,int), public.avoirs_grossistes(uuid),
  public.payer_facture(uuid,int,int), public.resultat_mois(uuid,date), private.premium(uuid) to authenticated;
