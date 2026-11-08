-- Wergui SN : schéma initial (Supabase / PostgreSQL)
-- Chaque pharmacie est un espace séparé : toutes les tables portent pharmacy_id,
-- et les règles RLS ne laissent voir ou modifier que les pharmacies dont on est membre actif.

-- ---------------------------------------------------------------- pharmacies et équipe
create table public.pharmacies (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (length(trim(nom)) between 2 and 120),
  adresse     text,
  ville       text,
  telephone   text,
  whatsapp    text,
  message_ticket text default 'Merci de votre visite. Bonne santé !',
  formule     text not null default 'petite' check (formule in ('petite','officine')),
  statut      text not null default 'essai'  check (statut in ('essai','actif','suspendu')),
  reglages    jsonb not null default jsonb_build_object(
                'alerte_jours', 90, 'securite_jours', 4, 'couverture_jours', 14,
                'reception_mois', 6, 'tiers_payant', 80,
                'paiements', jsonb_build_array('Espèces','Wave','Orange Money','Assurance')),
  created_at  timestamptz not null default now()
);

create table public.membres (
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  nom         text not null,
  role        text not null check (role in ('titulaire','adjoint','vendeur','stagiaire')),
  droits      jsonb not null default '{}'::jsonb,
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (pharmacy_id, user_id)
);
create index on public.membres (user_id);

-- Fonctions d'accès (security definer : lisent membres sans repasser par RLS)
create or replace function public.est_membre(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where pharmacy_id = p and user_id = auth.uid() and actif)
$$;
create or replace function public.est_titulaire(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where pharmacy_id = p and user_id = auth.uid() and actif and role = 'titulaire')
$$;
create or replace function public.a_droit(p uuid, d text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where pharmacy_id = p and user_id = auth.uid() and actif
                 and (role = 'titulaire' or coalesce((droits ->> d)::boolean, false)))
$$;

-- ---------------------------------------------------------------- catalogue et stock
create table public.rayons (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  nom text not null check (length(trim(nom)) between 1 and 80),
  unique (pharmacy_id, nom)
);
create table public.fournisseurs (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  nom text not null check (length(trim(nom)) between 1 and 80),
  delai_jours int not null default 1 check (delai_jours between 0 and 60),
  reprend_produits boolean not null default true,
  whatsapp text
);
create table public.produits (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  nom text not null check (length(trim(nom)) between 1 and 160),
  presentation text,
  rayon_id uuid references public.rayons on delete set null,
  fournisseur_id uuid references public.fournisseurs on delete set null,
  prix_vente int not null default 0 check (prix_vente >= 0),
  prix_achat int not null default 0 check (prix_achat >= 0),
  seuil int check (seuil >= 0),
  codes text[] not null default '{}',
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.produits (pharmacy_id);
create index on public.produits using gin (codes);

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  produit_id uuid not null references public.produits on delete cascade,
  numero text not null,
  peremption date not null,
  quantite int not null default 0 check (quantite >= 0),
  prioritaire boolean not null default false,
  created_at timestamptz not null default now(),
  unique (produit_id, numero, peremption)
);
create index on public.lots (pharmacy_id, peremption);

-- ---------------------------------------------------------------- ventes et mouvements
create table public.ventes (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  user_id uuid references auth.users on delete set null,
  total int not null,               -- après remise
  remise_pct int not null default 0,
  mode text not null,
  organisme text,
  part_assurance int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.ventes (pharmacy_id, created_at desc);
create table public.vente_lignes (
  id uuid primary key default gen_random_uuid(),
  vente_id uuid not null references public.ventes on delete cascade,
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  produit_id uuid references public.produits on delete set null,
  lot_id uuid references public.lots on delete set null,
  quantite int not null check (quantite > 0),
  prix_unitaire int not null,
  prix_achat int not null default 0
);
create index on public.vente_lignes (pharmacy_id, produit_id);

create table public.mouvements (   -- retraits (destruction), retours grossiste, écarts d'inventaire, entrées
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  type text not null check (type in ('entree','retrait','retour','inventaire')),
  produit_id uuid references public.produits on delete set null,
  lot_id uuid references public.lots on delete set null,
  quantite int not null,            -- négatif = sortie
  valeur int not null default 0,    -- au prix d'achat
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index on public.mouvements (pharmacy_id, created_at desc);

-- ---------------------------------------------------------------- commandes
create table public.commandes (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  numero serial,
  fournisseur_id uuid references public.fournisseurs on delete set null,
  statut text not null default 'envoyee' check (statut in ('envoyee','recue','annulee')),
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  recue_at timestamptz
);
create table public.commande_lignes (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references public.commandes on delete cascade,
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  produit_id uuid references public.produits on delete set null,
  quantite int not null check (quantite > 0)
);

-- ---------------------------------------------------------------- RLS
alter table public.pharmacies      enable row level security;
alter table public.membres         enable row level security;
alter table public.rayons          enable row level security;
alter table public.fournisseurs    enable row level security;
alter table public.produits        enable row level security;
alter table public.lots            enable row level security;
alter table public.ventes          enable row level security;
alter table public.vente_lignes    enable row level security;
alter table public.mouvements      enable row level security;
alter table public.commandes       enable row level security;
alter table public.commande_lignes enable row level security;

create policy lire on public.pharmacies for select to authenticated using (est_membre(id));
create policy modifier on public.pharmacies for update to authenticated using (est_titulaire(id)) with check (est_titulaire(id));

create policy lire on public.membres for select to authenticated using (est_membre(pharmacy_id));
-- ajout / modification des membres : uniquement par les fonctions ajouter_membre / modifier_membre

create policy lire on public.rayons for select to authenticated using (est_membre(pharmacy_id));
create policy ecrire on public.rayons for all to authenticated using (a_droit(pharmacy_id,'prod')) with check (a_droit(pharmacy_id,'prod'));
create policy lire on public.fournisseurs for select to authenticated using (est_membre(pharmacy_id));
create policy ecrire on public.fournisseurs for all to authenticated using (est_titulaire(pharmacy_id)) with check (est_titulaire(pharmacy_id));

create policy lire on public.produits for select to authenticated using (est_membre(pharmacy_id));
create policy creer on public.produits for insert to authenticated
  with check (a_droit(pharmacy_id,'prod') or a_droit(pharmacy_id,'recep'));
create policy modifier on public.produits for update to authenticated using (a_droit(pharmacy_id,'prod')) with check (a_droit(pharmacy_id,'prod'));
create policy supprimer on public.produits for delete to authenticated using (a_droit(pharmacy_id,'prod'));

create policy lire on public.lots for select to authenticated using (est_membre(pharmacy_id));
create policy prioriser on public.lots for update to authenticated using (est_membre(pharmacy_id)) with check (est_membre(pharmacy_id));
-- quantités : uniquement par les fonctions (entrée, vente, retrait, inventaire, réception)

create policy lire on public.ventes for select to authenticated using (est_membre(pharmacy_id));
create policy lire on public.vente_lignes for select to authenticated using (est_membre(pharmacy_id));
create policy lire on public.mouvements for select to authenticated using (est_membre(pharmacy_id));
create policy lire on public.commandes for select to authenticated
  using (a_droit(pharmacy_id,'cmd') or a_droit(pharmacy_id,'recep'));
create policy lire on public.commande_lignes for select to authenticated
  using (a_droit(pharmacy_id,'cmd') or a_droit(pharmacy_id,'recep'));

-- Seules les colonnes « prioritaire » des lots peuvent être modifiées directement
revoke update on public.lots from authenticated, anon;
grant update (prioritaire) on public.lots to authenticated;
revoke insert, update, delete on public.ventes, public.vente_lignes, public.mouvements,
  public.commandes, public.commande_lignes, public.membres from authenticated, anon;
revoke insert, delete on public.pharmacies from authenticated, anon;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- fonctions métier
-- Créer sa pharmacie (le créateur devient titulaire) avec rayons et grossistes par défaut
create or replace function public.creer_pharmacie(p_nom text, p_ville text, p_telephone text, p_nom_titulaire text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_r text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if (select count(*) from membres where user_id = auth.uid() and role = 'titulaire') >= 5 then
    raise exception 'Limite de 5 pharmacies par compte atteinte';
  end if;
  insert into pharmacies (nom, ville, telephone) values (trim(p_nom), nullif(trim(p_ville),''), nullif(trim(p_telephone),'')) returning id into v_id;
  insert into membres (pharmacy_id, user_id, nom, role) values (v_id, auth.uid(), coalesce(nullif(trim(p_nom_titulaire),''),'Titulaire'), 'titulaire');
  foreach v_r in array array['Antipaludiques','Antibiotiques','Antalgiques','Maladies chroniques','Digestif','Pédiatrie','Respiratoire','Vitamines','Parapharmacie'] loop
    insert into rayons (pharmacy_id, nom) values (v_id, v_r);
  end loop;
  insert into fournisseurs (pharmacy_id, nom, delai_jours, reprend_produits) values
    (v_id,'Laborex',1,true),(v_id,'Cophase',1,true),(v_id,'Sodipharm',2,false),(v_id,'Duopharm',2,true);
  return v_id;
end $$;

-- Ajouter un membre : la personne doit d'abord avoir créé son compte avec cet e-mail
create or replace function public.ajouter_membre(p uuid, p_email text, p_nom text, p_role text, p_droits jsonb)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if p_role not in ('adjoint','vendeur','stagiaire') then raise exception 'Rôle invalide'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'Aucun compte Wergui SN avec cet e-mail. Demandez à la personne de créer son compte (« Je rejoins une pharmacie »), puis réessayez.';
  end if;
  insert into membres (pharmacy_id, user_id, nom, role, droits) values (p, v_uid, trim(p_nom), p_role, coalesce(p_droits,'{}'))
  on conflict (pharmacy_id, user_id) do update set nom = excluded.nom, role = excluded.role, droits = excluded.droits, actif = true;
end $$;

create or replace function public.modifier_membre(p uuid, p_user uuid, p_nom text, p_role text, p_droits jsonb, p_actif boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if p_user = auth.uid() then
    update membres set nom = trim(p_nom) where pharmacy_id = p and user_id = p_user;   -- le titulaire ne change que son nom
    return;
  end if;
  if p_role not in ('adjoint','vendeur','stagiaire') then raise exception 'Rôle invalide'; end if;
  update membres set nom = trim(p_nom), role = p_role, droits = coalesce(p_droits,'{}'), actif = p_actif
   where pharmacy_id = p and user_id = p_user and role <> 'titulaire';
end $$;

-- Entrée en stock d'un lot (scanner, démarrage) : regroupe les boîtes du même lot
create or replace function public.ajouter_lot(p uuid, p_produit uuid, p_numero text, p_peremption date, p_quantite int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_pa int;
begin
  if not (a_droit(p,'recep') or a_droit(p,'prod') or a_droit(p,'inv')) then raise exception 'Droit « Réceptions » requis'; end if;
  if p_quantite <= 0 then raise exception 'Quantité invalide'; end if;
  if p_peremption < current_date then raise exception 'Lot périmé : il ne peut pas entrer en stock'; end if;
  select prix_achat into v_pa from produits where id = p_produit and pharmacy_id = p;
  if not found then raise exception 'Produit inconnu'; end if;
  insert into lots (pharmacy_id, produit_id, numero, peremption, quantite)
  values (p, p_produit, upper(trim(p_numero)), p_peremption, p_quantite)
  on conflict (produit_id, numero, peremption) do update set quantite = lots.quantite + excluded.quantite
  returning id into v_id;
  insert into mouvements (pharmacy_id, type, produit_id, lot_id, quantite, valeur, user_id)
  values (p, 'entree', p_produit, v_id, p_quantite, p_quantite * v_pa, auth.uid());
  return v_id;
end $$;

-- Vente : prix lus en base, sortie des lots qui périment en premier (FEFO), lots périmés exclus
create or replace function public.enregistrer_vente(p uuid, p_lignes jsonb, p_mode text, p_remise_pct int, p_organisme text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_vente uuid; v_ligne jsonb; v_reste int; v_lot record; v_prod record; v_take int;
  v_brut int := 0; v_total int; v_tp int; v_remise int := coalesce(p_remise_pct,0);
begin
  if not est_membre(p) then raise exception 'Accès refusé'; end if;
  if jsonb_array_length(coalesce(p_lignes,'[]')) = 0 then raise exception 'Ticket vide'; end if;
  if v_remise not in (0,5,10) then raise exception 'Remise invalide'; end if;
  if v_remise > 0 and not a_droit(p,'remise') then raise exception 'Droit « Remises » requis'; end if;
  if not ((select reglages->'paiements' from pharmacies where id = p) ? p_mode) then raise exception 'Moyen de paiement non accepté'; end if;
  insert into ventes (pharmacy_id, user_id, total, remise_pct, mode, organisme) values (p, auth.uid(), 0, v_remise, p_mode, nullif(p_organisme,''))
  returning id into v_vente;
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    select id, nom, prix_vente, prix_achat into v_prod from produits where id = (v_ligne->>'produit_id')::uuid and pharmacy_id = p;
    if not found then raise exception 'Produit inconnu'; end if;
    v_reste := (v_ligne->>'quantite')::int;
    if v_reste is null or v_reste <= 0 then raise exception 'Quantité invalide'; end if;
    for v_lot in select id, quantite from lots
                 where produit_id = v_prod.id and quantite > 0 and peremption >= current_date
                 order by peremption, created_at for update loop
      exit when v_reste = 0;
      v_take := least(v_lot.quantite, v_reste);
      update lots set quantite = quantite - v_take where id = v_lot.id;
      insert into vente_lignes (vente_id, pharmacy_id, produit_id, lot_id, quantite, prix_unitaire, prix_achat)
      values (v_vente, p, v_prod.id, v_lot.id, v_take, v_prod.prix_vente, v_prod.prix_achat);
      v_brut := v_brut + v_take * v_prod.prix_vente;
      v_reste := v_reste - v_take;
    end loop;
    if v_reste > 0 then raise exception 'Stock insuffisant pour %', v_prod.nom; end if;
  end loop;
  v_total := round(v_brut * (100 - v_remise) / 100.0);
  v_tp := case when p_mode = 'Assurance' then round(v_total * coalesce((select (reglages->>'tiers_payant')::int from pharmacies where id = p),80) / 100.0) else 0 end;
  update ventes set total = v_total, part_assurance = v_tp where id = v_vente;
  return v_vente;
end $$;

-- Retirer un lot (destruction) ou le rendre au grossiste
create or replace function public.sortir_lot(p_lot uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select l.*, pr.prix_achat into v from lots l join produits pr on pr.id = l.produit_id where l.id = p_lot;
  if not found then raise exception 'Lot inconnu'; end if;
  if not a_droit(v.pharmacy_id,'per') then raise exception 'Droit « Retraits et retours » requis'; end if;
  if p_type not in ('retrait','retour') then raise exception 'Type invalide'; end if;
  if v.quantite = 0 then return; end if;
  insert into mouvements (pharmacy_id, type, produit_id, lot_id, quantite, valeur, user_id)
  values (v.pharmacy_id, p_type, v.produit_id, v.id, -v.quantite, v.quantite * v.prix_achat, auth.uid());
  update lots set quantite = 0, prioritaire = false where id = p_lot;
end $$;

-- Inventaire : aligne le stock d'un produit sur la quantité comptée
create or replace function public.ajuster_inventaire(p uuid, p_produit uuid, p_compte int)
returns int language plpgsql security definer set search_path = public as $$
declare v_theo int; v_ecart int; v_lot record; v_take int; v_pa int;
begin
  if not a_droit(p,'inv') then raise exception 'Droit « Inventaires » requis'; end if;
  if p_compte < 0 then raise exception 'Quantité invalide'; end if;
  select prix_achat into v_pa from produits where id = p_produit and pharmacy_id = p;
  if not found then raise exception 'Produit inconnu'; end if;
  select coalesce(sum(quantite),0) into v_theo from lots where produit_id = p_produit;
  v_ecart := p_compte - v_theo;
  if v_ecart < 0 then
    v_take := -v_ecart;
    for v_lot in select id, quantite from lots where produit_id = p_produit and quantite > 0 order by peremption for update loop
      exit when v_take = 0;
      update lots set quantite = quantite - least(quantite, v_take) where id = v_lot.id;
      v_take := v_take - least(v_lot.quantite, v_take);
    end loop;
  elsif v_ecart > 0 then
    select id into v_lot from lots where produit_id = p_produit order by peremption desc limit 1;
    if v_lot.id is null then raise exception 'Aucun lot : faites une entrée en stock avec n° de lot et date'; end if;
    update lots set quantite = quantite + v_ecart where id = v_lot.id;
  end if;
  if v_ecart <> 0 then
    insert into mouvements (pharmacy_id, type, produit_id, quantite, valeur, user_id)
    values (p, 'inventaire', p_produit, v_ecart, v_ecart * v_pa, auth.uid());
  end if;
  return v_ecart;
end $$;

-- Commandes
create or replace function public.creer_commande(p uuid, p_fournisseur uuid, p_lignes jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_l jsonb;
begin
  if not a_droit(p,'cmd') then raise exception 'Droit « Commandes » requis'; end if;
  if not exists (select 1 from fournisseurs where id = p_fournisseur and pharmacy_id = p) then raise exception 'Grossiste inconnu'; end if;
  insert into commandes (pharmacy_id, fournisseur_id, user_id) values (p, p_fournisseur, auth.uid()) returning id into v_id;
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    if (v_l->>'quantite')::int > 0 and exists (select 1 from produits where id = (v_l->>'produit_id')::uuid and pharmacy_id = p) then
      insert into commande_lignes (commande_id, pharmacy_id, produit_id, quantite) values (v_id, p, (v_l->>'produit_id')::uuid, (v_l->>'quantite')::int);
    end if;
  end loop;
  if not exists (select 1 from commande_lignes where commande_id = v_id) then raise exception 'Commande vide'; end if;
  return v_id;
end $$;

create or replace function public.receptionner_commande(p_commande uuid, p_lignes jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_c record; v_l jsonb; v_n int := 0;
begin
  select * into v_c from commandes where id = p_commande;
  if not found then raise exception 'Commande inconnue'; end if;
  if not a_droit(v_c.pharmacy_id,'recep') then raise exception 'Droit « Réceptions » requis'; end if;
  if v_c.statut <> 'envoyee' then raise exception 'Commande déjà traitée'; end if;
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    if coalesce((v_l->>'quantite')::int,0) > 0 then
      perform ajouter_lot(v_c.pharmacy_id, (v_l->>'produit_id')::uuid, v_l->>'numero', (v_l->>'peremption')::date, (v_l->>'quantite')::int);
      v_n := v_n + (v_l->>'quantite')::int;
    end if;
  end loop;
  update commandes set statut = 'recue', recue_at = now() where id = p_commande;
  return v_n;
end $$;

revoke all on function public.creer_pharmacie(text,text,text,text), public.ajouter_membre(uuid,text,text,text,jsonb),
  public.modifier_membre(uuid,uuid,text,text,jsonb,boolean), public.ajouter_lot(uuid,uuid,text,date,int),
  public.enregistrer_vente(uuid,jsonb,text,int,text), public.sortir_lot(uuid,text), public.ajuster_inventaire(uuid,uuid,int),
  public.creer_commande(uuid,uuid,jsonb), public.receptionner_commande(uuid,jsonb),
  public.est_membre(uuid), public.est_titulaire(uuid), public.a_droit(uuid,text) from public, anon;
grant execute on function public.creer_pharmacie(text,text,text,text), public.ajouter_membre(uuid,text,text,text,jsonb),
  public.modifier_membre(uuid,uuid,text,text,jsonb,boolean), public.ajouter_lot(uuid,uuid,text,date,int),
  public.enregistrer_vente(uuid,jsonb,text,int,text), public.sortir_lot(uuid,text), public.ajuster_inventaire(uuid,uuid,int),
  public.creer_commande(uuid,uuid,jsonb), public.receptionner_commande(uuid,jsonb),
  public.est_membre(uuid), public.est_titulaire(uuid), public.a_droit(uuid,text) to authenticated;
