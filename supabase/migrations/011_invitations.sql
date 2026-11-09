-- Wergui SN : invitation d'un membre par lien (WhatsApp), sans échange d'e-mail avec le titulaire.
-- Le titulaire crée un lien (rôle et droits choisis) ; la personne l'ouvre, crée son compte ou se connecte,
-- et rejoint la pharmacie. Lien à usage unique, valable 7 jours, annulable.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies on delete cascade,
  code text not null unique,
  nom text check (length(nom) <= 80),
  role text not null check (role in ('adjoint','vendeur','stagiaire')),
  droits jsonb not null default '{}'::jsonb,
  cree_par uuid references auth.users on delete set null,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null default now() + interval '7 days',
  utilisee_par uuid references auth.users on delete set null,
  utilisee_le timestamptz
);
create index if not exists invitations_ph on public.invitations (pharmacy_id, cree_le desc);
alter table public.invitations enable row level security;
create policy lire on public.invitations for select to authenticated using (private.est_titulaire(pharmacy_id));
revoke insert, update, delete on public.invitations from authenticated, anon;
revoke all on public.invitations from anon;

create or replace function public.creer_invitation(p uuid, p_nom text, p_role text, p_droits jsonb)
returns text language plpgsql security definer set search_path = public, private, extensions as $$
declare v text;
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if p_role not in ('adjoint','vendeur','stagiaire') then raise exception 'Rôle invalide'; end if;
  if (select count(*) from invitations where pharmacy_id = p and utilisee_le is null and expire_le > now()) >= 20 then
    raise exception 'Trop d''invitations en attente : annulez-en quelques-unes.';
  end if;
  -- 16 caractères aléatoires (environ 95 bits) : impossible à deviner
  v := translate(encode(gen_random_bytes(12), 'base64'), '+/=', 'xyz');
  insert into invitations (pharmacy_id, code, nom, role, droits, cree_par)
  values (p, v, nullif(trim(left(coalesce(p_nom, ''), 80)), ''), p_role, coalesce(p_droits, '{}'), auth.uid());
  return v;
end $$;

create or replace function public.annuler_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_ph uuid;
begin
  select pharmacy_id into v_ph from invitations where id = p_id;
  if v_ph is null or not est_titulaire(v_ph) then raise exception 'Invitation introuvable'; end if;
  delete from invitations where id = p_id and utilisee_le is null;
end $$;

-- Lisible sans compte : seulement le nom de la pharmacie et le rôle proposé, pour un code valide
create or replace function public.voir_invitation(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare r record;
begin
  select i.*, ph.nom as ph_nom, ph.ville as ph_ville into r from invitations i join pharmacies ph on ph.id = i.pharmacy_id where i.code = p_code;
  if not found then return jsonb_build_object('ok', false, 'raison', 'Lien d''invitation inconnu ou annulé.'); end if;
  if r.utilisee_le is not null then return jsonb_build_object('ok', false, 'raison', 'Ce lien d''invitation a déjà été utilisé.'); end if;
  if r.expire_le < now() then return jsonb_build_object('ok', false, 'raison', 'Ce lien d''invitation a expiré : demandez-en un nouveau au titulaire.'); end if;
  return jsonb_build_object('ok', true, 'pharmacie', r.ph_nom, 'ville', r.ph_ville, 'role', r.role, 'nom', r.nom);
end $$;

create or replace function public.accepter_invitation(p_code text, p_nom text)
returns uuid language plpgsql security definer set search_path = public, private, auth as $$
declare r invitations; v_nom text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into r from invitations where code = p_code for update;
  if not found then raise exception 'Lien d''invitation inconnu ou annulé.'; end if;
  if r.utilisee_le is not null then
    if r.utilisee_par = auth.uid() then return r.pharmacy_id; end if;
    raise exception 'Ce lien d''invitation a déjà été utilisé.';
  end if;
  if r.expire_le < now() then raise exception 'Ce lien d''invitation a expiré : demandez-en un nouveau au titulaire.'; end if;
  if exists (select 1 from membres where pharmacy_id = r.pharmacy_id and user_id = auth.uid() and role = 'titulaire') then
    raise exception 'Vous êtes déjà titulaire de cette pharmacie.';
  end if;
  v_nom := coalesce(nullif(trim(left(coalesce(p_nom, ''), 80)), ''), r.nom,
                    nullif(trim((select raw_user_meta_data->>'nom' from auth.users where id = auth.uid())), ''), 'Membre');
  insert into membres (pharmacy_id, user_id, nom, role, droits) values (r.pharmacy_id, auth.uid(), v_nom, r.role, r.droits)
  on conflict (pharmacy_id, user_id) do update set role = excluded.role, droits = excluded.droits, actif = true;
  update invitations set utilisee_par = auth.uid(), utilisee_le = now() where id = r.id;
  return r.pharmacy_id;
end $$;

revoke all on function public.creer_invitation(uuid,text,text,jsonb), public.annuler_invitation(uuid),
  public.voir_invitation(text), public.accepter_invitation(text,text) from public;
grant execute on function public.creer_invitation(uuid,text,text,jsonb), public.annuler_invitation(uuid),
  public.accepter_invitation(text,text) to authenticated;
grant execute on function public.voir_invitation(text) to anon, authenticated;
