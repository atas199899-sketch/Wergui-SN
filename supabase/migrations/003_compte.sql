-- Wergui SN : suppression de compte, suppression de pharmacie, transfert du rôle de titulaire.

-- Supprimer définitivement une pharmacie et toutes ses données (titulaire, en retapant le nom)
create or replace function public.supprimer_pharmacie(p uuid, p_nom text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if (select nom from pharmacies where id = p) is distinct from trim(p_nom) then
    raise exception 'Le nom saisi ne correspond pas au nom de la pharmacie';
  end if;
  delete from pharmacies where id = p;   -- supprime en cascade équipe, stock, ventes, commandes
end $$;

-- Transférer le rôle de titulaire à un autre membre actif (l'ancien titulaire devient pharmacien adjoint)
create or replace function public.transferer_titulaire(p uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not est_titulaire(p) then raise exception 'Réservé au titulaire'; end if;
  if p_user = auth.uid() then raise exception 'Choisissez un autre membre'; end if;
  if not exists (select 1 from membres where pharmacy_id = p and user_id = p_user and actif) then
    raise exception 'Ce membre n''est pas actif dans la pharmacie';
  end if;
  update membres set role = 'titulaire', droits = '{}'::jsonb where pharmacy_id = p and user_id = p_user;
  update membres set role = 'adjoint',
         droits = '{"dash":true,"achat":true,"remise":true,"per":true,"recep":true,"cmd":true,"inv":true,"prod":true,"fin":true}'::jsonb
   where pharmacy_id = p and user_id = auth.uid();
end $$;

-- Supprimer son propre compte. Un titulaire doit d'abord transférer sa pharmacie,
-- ou accepter explicitement de la supprimer avec toutes ses données.
create or replace function public.supprimer_mon_compte(p_supprimer_pharmacies boolean)
returns void language plpgsql security definer set search_path = public, private, auth as $$
declare r record; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  for r in select m.pharmacy_id, ph.nom from membres m join pharmacies ph on ph.id = m.pharmacy_id
           where m.user_id = v_uid and m.role = 'titulaire' loop
    if exists (select 1 from membres where pharmacy_id = r.pharmacy_id and role = 'titulaire' and user_id <> v_uid and actif) then
      continue;
    end if;
    if coalesce(p_supprimer_pharmacies, false) then
      delete from pharmacies where id = r.pharmacy_id;
    else
      raise exception 'Vous êtes titulaire de « % ». Transférez d''abord le rôle de titulaire à un membre, ou acceptez la suppression de la pharmacie.', r.nom;
    end if;
  end loop;
  delete from auth.users where id = v_uid;   -- membres supprimés en cascade ; ventes conservées sans nom de vendeur
end $$;

revoke all on function public.supprimer_pharmacie(uuid, text), public.transferer_titulaire(uuid, uuid),
  public.supprimer_mon_compte(boolean) from public, anon;
grant execute on function public.supprimer_pharmacie(uuid, text), public.transferer_titulaire(uuid, uuid),
  public.supprimer_mon_compte(boolean) to authenticated;
