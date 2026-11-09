-- Wergui SN : connexion au poste de la pharmacie en choisissant son nom et en tapant son code PIN.
-- • Le titulaire déclare un appareil comme « poste » : l'appareil reçoit un jeton secret (seule son empreinte est gardée ici).
-- • Sur ce poste, la liste des membres s'affiche ; le PIN est vérifié par le serveur (5 erreurs = blocage 15 min),
--   puis la fonction « pin » (Edge Function) ouvre la session. Le PIN seul ne suffit pas : il faut aussi le jeton du poste.
-- • Le titulaire peut créer un compte vendeur sans e-mail (nom + PIN), utilisable uniquement sur ses postes.

alter table public.membres add column if not exists sans_email boolean not null default false;

create table if not exists public.postes (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  nom text not null check (length(nom) between 1 and 60),
  jeton_hash text not null unique,
  cree_par uuid references auth.users on delete set null,
  cree_le timestamptz not null default now(),
  vu_le timestamptz
);
alter table public.postes enable row level security;
create policy lire on public.postes for select to authenticated using (private.est_titulaire(pharmacy_id));
revoke insert, update, delete on public.postes from authenticated, anon;
revoke all on public.postes from anon;
revoke select (jeton_hash) on public.postes from authenticated;

create or replace function private.empreinte(t text) returns text language sql immutable set search_path = extensions as $$
  select encode(digest(coalesce(t, ''), 'sha256'), 'hex')
$$;

create or replace function private.pin_valide(p_pin text) returns void language plpgsql immutable as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'Le code PIN doit avoir 4 à 6 chiffres.'; end if;
  if p_pin ~ '^(.)\1+$' or p_pin in ('1234','12345','123456','4321','654321','0123','01234','012345') then
    raise exception 'Code trop facile à deviner : choisissez-en un autre.';
  end if;
end $$;

-- ------------------------------------------------------------ postes (titulaire)
create or replace function public.creer_poste(p uuid, p_nom text)
returns text language plpgsql security definer set search_path = public, private, extensions as $$
declare v text := encode(gen_random_bytes(24), 'hex');
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if (select count(*) from postes where pharmacy_id = p) >= 10 then raise exception 'Maximum 10 postes par pharmacie : retirez-en un.'; end if;
  insert into postes (pharmacy_id, nom, jeton_hash, cree_par) values (p, coalesce(nullif(trim(left(p_nom, 60)), ''), 'Poste'), private.empreinte(v), auth.uid());
  return v;
end $$;

create or replace function public.supprimer_poste(p_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_ph uuid;
begin
  select pharmacy_id into v_ph from postes where id = p_id;
  if v_ph is null or not est_titulaire(v_ph) then raise exception 'Poste introuvable'; end if;
  delete from postes where id = p_id;
end $$;

-- Le poste quitte lui-même (bouton « ne plus utiliser cet appareil »), avec son propre jeton
create or replace function public.quitter_poste(p_jeton text)
returns void language sql security definer set search_path = public, private as $$
  delete from postes where jeton_hash = private.empreinte(p_jeton)
$$;

-- Sur le poste, sans être connecté : nom de la pharmacie et liste des membres actifs
create or replace function public.poste_info(p_jeton text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare po postes;
begin
  select * into po from postes where jeton_hash = private.empreinte(p_jeton);
  if not found then return jsonb_build_object('ok', false); end if;
  update postes set vu_le = now() where id = po.id;
  return jsonb_build_object('ok', true, 'pharmacy_id', po.pharmacy_id, 'poste', po.nom,
    'pharmacie', (select nom from pharmacies where id = po.pharmacy_id),
    'membres', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nom', m.nom, 'role', m.role,
                  'pin', exists (select 1 from pins where user_id = m.user_id)) order by (m.role <> 'titulaire'), m.nom)
                from membres m where m.pharmacy_id = po.pharmacy_id and m.actif), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------ connexion par PIN (appelée par la fonction serveur)
create or replace function public.pin_connexion(p_jeton text, p_user uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, private, extensions as $$
declare po postes; r pins; v_email text;
begin
  select * into po from postes where jeton_hash = private.empreinte(p_jeton);
  if not found then return jsonb_build_object('ok', false, 'raison', 'Cet appareil n''est plus un poste de la pharmacie.'); end if;
  if not exists (select 1 from membres where pharmacy_id = po.pharmacy_id and user_id = p_user and actif) then
    return jsonb_build_object('ok', false, 'raison', 'Ce compte ne fait plus partie de la pharmacie.');
  end if;
  select * into r from pins where user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'Pas encore de code PIN pour ce compte.'); end if;
  if r.bloque_jusqu > now() then
    return jsonb_build_object('ok', false, 'bloque_min', ceil(extract(epoch from r.bloque_jusqu - now()) / 60));
  end if;
  if r.hash <> crypt(coalesce(p_pin, ''), r.hash) then
    if r.essais + 1 >= 5 then
      update pins set essais = 0, bloque_jusqu = now() + interval '15 minutes' where user_id = p_user;
      return jsonb_build_object('ok', false, 'bloque_min', 15);
    end if;
    update pins set essais = r.essais + 1 where user_id = p_user;
    return jsonb_build_object('ok', false, 'reste', 4 - r.essais);
  end if;
  update pins set essais = 0, bloque_jusqu = null where user_id = p_user;
  update postes set vu_le = now() where id = po.id;
  select email into v_email from auth.users where id = p_user;
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

-- ------------------------------------------------------------ compte sans e-mail créé par le titulaire
create or replace function public.membre_sans_email_verifier(p uuid, p_demandeur uuid, p_nom text, p_role text, p_pin text)
returns void language plpgsql security definer set search_path = public, private as $$
declare ph pharmacies;
begin
  if not exists (select 1 from membres where pharmacy_id = p and user_id = p_demandeur and role = 'titulaire' and actif) then raise exception 'Réservé au titulaire'; end if;
  if p_role not in ('adjoint','vendeur','stagiaire') then raise exception 'Rôle invalide'; end if;
  if length(trim(coalesce(p_nom, ''))) not between 2 and 80 then raise exception 'Indiquez le nom de la personne.'; end if;
  perform private.pin_valide(p_pin);
  select * into ph from pharmacies where id = p;
  if ph.formule = 'petite' and ph.statut <> 'essai' and (select count(*) from membres where pharmacy_id = p and actif and role <> 'titulaire') >= 1 then
    raise exception 'La formule Petite officine permet un seul membre en plus du titulaire. Passez à la formule Officine pour une équipe illimitée.';
  end if;
end $$;

create or replace function public.membre_sans_email_creer(p uuid, p_demandeur uuid, p_user uuid, p_nom text, p_role text, p_pin text)
returns void language plpgsql security definer set search_path = public, private, extensions as $$
begin
  perform membre_sans_email_verifier(p, p_demandeur, p_nom, p_role, p_pin);
  insert into membres (pharmacy_id, user_id, nom, role, droits, sans_email) values (p, p_user, trim(p_nom), p_role, private.droits_role(p_role), true);
  insert into pins (user_id, hash) values (p_user, crypt(p_pin, gen_salt('bf', 8)))
  on conflict (user_id) do update set hash = excluded.hash, essais = 0, bloque_jusqu = null, modifie_le = now();
end $$;

-- Le titulaire change le PIN d'un compte sans e-mail (code oublié). Les comptes avec e-mail choisissent eux-mêmes leur PIN.
create or replace function public.definir_pin_membre(p uuid, p_user uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if not exists (select 1 from membres where pharmacy_id = p and user_id = p_user and sans_email) then
    raise exception 'Seuls les comptes sans e-mail ont un code PIN choisi par le titulaire.';
  end if;
  perform private.pin_valide(p_pin);
  insert into pins (user_id, hash) values (p_user, crypt(p_pin, gen_salt('bf', 8)))
  on conflict (user_id) do update set hash = excluded.hash, essais = 0, bloque_jusqu = null, modifie_le = now();
end $$;

revoke all on function public.creer_poste(uuid,text), public.supprimer_poste(uuid), public.quitter_poste(text), public.poste_info(text),
  public.pin_connexion(text,uuid,text), public.membre_sans_email_verifier(uuid,uuid,text,text,text),
  public.membre_sans_email_creer(uuid,uuid,uuid,text,text,text), public.definir_pin_membre(uuid,uuid,text),
  private.empreinte(text), private.pin_valide(text) from public, anon, authenticated;
grant execute on function public.creer_poste(uuid,text), public.supprimer_poste(uuid), public.definir_pin_membre(uuid,uuid,text) to authenticated;
grant execute on function public.poste_info(text), public.quitter_poste(text) to anon, authenticated;
-- appelées uniquement par la fonction serveur (clé de service)
grant execute on function public.pin_connexion(text,uuid,text), public.membre_sans_email_verifier(uuid,uuid,text,text,text),
  public.membre_sans_email_creer(uuid,uuid,uuid,text,text,text) to service_role;
