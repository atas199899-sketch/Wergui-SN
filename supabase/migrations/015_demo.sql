-- Wergui SN : pharmacie de démonstration remise à la date du jour d'un clic (console administrateur).
-- Toutes les dates de la pharmacie démo sont décalées d'un même écart : la dernière vente tombe « maintenant »,
-- les alertes de péremption, factures, clôtures… gardent les mêmes échéances relatives. Réservé aux pharmacies marquées démo.

alter table public.pharmacies add column if not exists demo boolean not null default false;

create or replace function public.admin_rafraichir_demo(p uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d interval; j int; v_caisse boolean := false; v_vendeur uuid;
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  if not coalesce((select demo from pharmacies where id = p), false) then raise exception 'Seule une pharmacie de démonstration peut être remise à la date du jour.'; end if;
  select now() - max(created_at) - interval '20 minutes' into d from ventes where pharmacy_id = p;
  if d is null then raise exception 'Aucune vente dans la démo'; end if;
  j := floor(extract(epoch from d) / 86400)::int;
  if d > interval '0' then
    update ventes set created_at = created_at + d where pharmacy_id = p;
    update vente_lignes set created_at = created_at + d where pharmacy_id = p;
    update mouvements set created_at = created_at + d where pharmacy_id = p;
    update commandes set created_at = created_at + d, recue_at = recue_at + d where pharmacy_id = p;
    update caisses set ouverte_le = ouverte_le + d, fermee_le = fermee_le + d where pharmacy_id = p;
    update depenses set created_at = created_at + d, date_depense = date_depense + j where pharmacy_id = p;
    update bordereaux set created_at = created_at + d, envoye_le = envoye_le + j where pharmacy_id = p;
    update factures set created_at = created_at + d, date_facture = date_facture + j, echeance = echeance + j where pharmacy_id = p;
    update lots set created_at = created_at + d, peremption = peremption + j where pharmacy_id = p;
    update produits set created_at = created_at + d where pharmacy_id = p;
  end if;
  -- caisse du jour ouverte (une présentation a pu la clôturer)
  if not exists (select 1 from caisses where pharmacy_id = p and statut = 'ouverte') then
    select user_id into v_vendeur from membres where pharmacy_id = p and role = 'vendeur' and actif order by created_at limit 1;
    insert into caisses (pharmacy_id, fond, ouverte_par, ouverte_le)
    values (p, 25000, coalesce(v_vendeur, auth.uid()), least(now(), date_trunc('day', now()) + interval '8 hours'));
    v_caisse := true;
  end if;
  update pharmacies set essai_fin = greatest(essai_fin, current_date + 3650) where id = p;
  return jsonb_build_object('jours', j, 'heures', round(extract(epoch from greatest(d, interval '0')) / 3600), 'caisse_ouverte', v_caisse);
end $$;

-- La console distingue la démo (et ne la compte pas dans les statistiques)
drop function if exists public.admin_pharmacies();
create or replace function public.admin_pharmacies()
returns table (id uuid, nom text, ville text, telephone text, formule text, statut text, essai_fin date, paye_jusqu date,
               created_at timestamptz, titulaire text, membres bigint, produits bigint, ventes_30j bigint, demo boolean)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  return query
    select ph.id, ph.nom, ph.ville, ph.telephone, ph.formule, ph.statut, ph.essai_fin, ph.paye_jusqu, ph.created_at,
           (select m.nom from membres m where m.pharmacy_id = ph.id and m.role = 'titulaire' limit 1),
           (select count(*) from membres m where m.pharmacy_id = ph.id and m.actif),
           (select count(*) from produits pr where pr.pharmacy_id = ph.id),
           (select count(*) from ventes v where v.pharmacy_id = ph.id and v.created_at > now() - interval '30 days'),
           ph.demo
      from pharmacies ph order by ph.demo desc, ph.created_at desc;
end $$;

revoke all on function public.admin_rafraichir_demo(uuid), public.admin_pharmacies() from public, anon;
grant execute on function public.admin_rafraichir_demo(uuid), public.admin_pharmacies() to authenticated;
