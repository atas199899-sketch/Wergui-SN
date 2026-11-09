-- Wergui SN : ventes faites sans internet, envoyées au retour du réseau.
-- Chaque vente porte un identifiant créé sur l'appareil : un renvoi ne la compte jamais deux fois.
-- Elle garde l'heure réelle de la vente. La vente a déjà eu lieu au comptoir : si le stock en base ne suffit plus
-- (vendu entre-temps sur un autre appareil), la vente est quand même enregistrée et l'écart est signalé.

alter table public.ventes add column if not exists client_id uuid;
alter table public.ventes add column if not exists hors_ligne boolean not null default false;
create unique index if not exists ventes_client_id on public.ventes (pharmacy_id, client_id) where client_id is not null;
alter table public.vente_lignes add column if not exists stock_manquant boolean not null default false;
grant select (stock_manquant) on public.vente_lignes to authenticated;

drop function if exists public.enregistrer_vente_hors_ligne(uuid,uuid,jsonb,text,int,text,timestamptz);
-- p_hors_ligne = false : vente faite avec internet (stock insuffisant refusé) ; true : vente envoyée après coup
create or replace function public.enregistrer_vente_hors_ligne(p uuid, p_client_id uuid, p_lignes jsonb, p_mode text,
  p_remise_pct int, p_organisme text, p_vendu_le timestamptz, p_hors_ligne boolean)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_vente uuid; v_ligne jsonb; v_reste int; v_lot record; v_prod record; v_take int; v_manque int := 0;
  v_brut int := 0; v_total int; v_tp int; v_remise int := coalesce(p_remise_pct,0);
  v_quand timestamptz := least(now(), greatest(coalesce(p_vendu_le, now()), now() - interval '7 days'));
begin
  if not est_membre(p) then raise exception 'Accès refusé'; end if;
  if p_client_id is null then raise exception 'Identifiant de vente manquant'; end if;
  select id into v_vente from ventes where pharmacy_id = p and client_id = p_client_id;
  if found then return jsonb_build_object('id', v_vente, 'deja', true); end if;   -- déjà reçue : rien à refaire
  if jsonb_array_length(coalesce(p_lignes,'[]')) = 0 then raise exception 'Ticket vide'; end if;
  if v_remise not in (0,5,10) then raise exception 'Remise invalide'; end if;
  if v_remise > 0 and not a_droit(p,'remise') then raise exception 'Droit « Remises » requis'; end if;
  if not ((select reglages->'paiements' from pharmacies where id = p) ? p_mode) then raise exception 'Moyen de paiement non accepté'; end if;
  insert into ventes (pharmacy_id, user_id, total, remise_pct, mode, organisme, client_id, hors_ligne, created_at)
  values (p, auth.uid(), 0, v_remise, p_mode, nullif(p_organisme,''), p_client_id, coalesce(p_hors_ligne, true), v_quand)
  returning id into v_vente;
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    select id, nom, prix_vente, prix_achat into v_prod from produits where id = (v_ligne->>'produit_id')::uuid and pharmacy_id = p;
    if not found then raise exception 'Produit inconnu (supprimé depuis la vente ?)'; end if;
    v_reste := (v_ligne->>'quantite')::int;
    if v_reste is null or v_reste <= 0 or v_reste > 10000 then raise exception 'Quantité invalide'; end if;
    for v_lot in select id, quantite from lots
                 where produit_id = v_prod.id and quantite > 0 and peremption >= v_quand::date
                 order by peremption, created_at for update loop
      exit when v_reste = 0;
      v_take := least(v_lot.quantite, v_reste);
      update lots set quantite = quantite - v_take where id = v_lot.id;
      insert into vente_lignes (vente_id, pharmacy_id, produit_id, lot_id, quantite, prix_unitaire, prix_achat, created_at)
      values (v_vente, p, v_prod.id, v_lot.id, v_take, v_prod.prix_vente, v_prod.prix_achat, v_quand);
      v_brut := v_brut + v_take * v_prod.prix_vente;
      v_reste := v_reste - v_take;
    end loop;
    if v_reste > 0 and not coalesce(p_hors_ligne, true) then raise exception 'Stock insuffisant pour %', v_prod.nom; end if;
    if v_reste > 0 then   -- vendu au comptoir mais plus en stock dans la base : on garde la vente et on signale l'écart
      insert into vente_lignes (vente_id, pharmacy_id, produit_id, lot_id, quantite, prix_unitaire, prix_achat, created_at, stock_manquant)
      values (v_vente, p, v_prod.id, null, v_reste, v_prod.prix_vente, v_prod.prix_achat, v_quand, true);
      v_brut := v_brut + v_reste * v_prod.prix_vente;
      v_manque := v_manque + v_reste;
    end if;
  end loop;
  v_total := round(v_brut * (100 - v_remise) / 100.0);
  v_tp := case when p_mode = 'Assurance' then round(v_total * coalesce((select (reglages->>'tiers_payant')::int from pharmacies where id = p),80) / 100.0) else 0 end;
  update ventes set total = v_total, part_assurance = v_tp where id = v_vente;
  return jsonb_build_object('id', v_vente, 'total', v_total, 'manquant', v_manque);
end $$;

revoke all on function public.enregistrer_vente_hors_ligne(uuid,uuid,jsonb,text,int,text,timestamptz,boolean) from public, anon;
grant execute on function public.enregistrer_vente_hors_ligne(uuid,uuid,jsonb,text,int,text,timestamptz,boolean) to authenticated;
