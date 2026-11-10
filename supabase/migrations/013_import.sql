-- Wergui SN : import du catalogue et du stock depuis un fichier Excel / CSV.
-- L'application lit le fichier et envoie des lignes déjà lues ; la base vérifie et enregistre tout d'un bloc
-- (en cas d'erreur, rien n'est importé). Un produit existant est retrouvé par son code, sinon par son nom et sa présentation.

create or replace function public.importer_produits(p uuid, p_lignes jsonb, p_maj_prix boolean)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  l jsonb; n int := 0; v_prod uuid; v_ray uuid; v_four uuid; v_code text; v_nom text; v_pres text; v_pv int; v_pa int; v_q int; v_exp date;
  crees int := 0; maj int := 0; lots_ok int := 0; boites int := 0; perimes int := 0; rayons_crees int := 0; fours_crees int := 0;
  v_limite boolean; v_nb int;
begin
  if not a_droit(p,'prod') then raise exception 'Droit « Produits et prix » requis pour importer.'; end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then raise exception 'Fichier vide'; end if;
  if jsonb_array_length(p_lignes) > 3000 then raise exception 'Maximum 3 000 lignes par import : découpez le fichier.'; end if;
  if exists (select 1 from jsonb_array_elements(p_lignes) x where coalesce((x->>'quantite')::int, 0) > 0) and not a_droit(p,'recep') then
    raise exception 'Droit « Réceptions » requis pour importer du stock.';
  end if;
  select formule = 'petite' and statut <> 'essai' into v_limite from pharmacies where id = p;

  for l in select * from jsonb_array_elements(p_lignes) loop
    n := n + 1;
    v_nom := nullif(trim(left(l->>'nom', 160)), '');
    if v_nom is null then raise exception 'Ligne % : nom du produit manquant', l->>'ligne'; end if;
    v_pres := nullif(trim(left(coalesce(l->>'presentation', ''), 120)), '');
    v_code := nullif(regexp_replace(coalesce(l->>'code', ''), '\s', '', 'g'), '');
    if v_code is not null and v_code !~ '^[0-9A-Za-z]{4,20}$' then raise exception 'Ligne % : code « % » invalide', l->>'ligne', v_code; end if;
    if v_code ~ '^[0-9]{13}$' and v_code like '340%' then v_code := '0' || v_code; end if;   -- CIP 13 -> code de la boîte (GTIN 14)
    v_pv := nullif(l->>'prix_vente', '')::int; v_pa := nullif(l->>'prix_achat', '')::int;
    if coalesce(v_pv, 0) < 0 or coalesce(v_pa, 0) < 0 or coalesce(v_pv, 0) > 10000000 or coalesce(v_pa, 0) > 10000000 then raise exception 'Ligne % : prix invalide', l->>'ligne'; end if;
    v_q := coalesce(nullif(l->>'quantite', '')::int, 0);
    if v_q < 0 or v_q > 100000 then raise exception 'Ligne % : quantité invalide', l->>'ligne'; end if;

    -- rayon et grossiste : créés s'ils n'existent pas encore
    v_ray := null; v_four := null;
    if nullif(trim(l->>'rayon'), '') is not null then
      select id into v_ray from rayons where pharmacy_id = p and lower(nom) = lower(trim(l->>'rayon'));
      if v_ray is null then insert into rayons (pharmacy_id, nom) values (p, trim(left(l->>'rayon', 80))) returning id into v_ray; rayons_crees := rayons_crees + 1; end if;
    end if;
    if nullif(trim(l->>'fournisseur'), '') is not null then
      select id into v_four from fournisseurs where pharmacy_id = p and lower(nom) = lower(trim(l->>'fournisseur'));
      if v_four is null then insert into fournisseurs (pharmacy_id, nom) values (p, trim(left(l->>'fournisseur', 80))) returning id into v_four; fours_crees := fours_crees + 1; end if;
    end if;

    -- produit existant : par code, sinon par nom + présentation
    v_prod := null;
    if v_code is not null then select id into v_prod from produits where pharmacy_id = p and v_code = any(codes) limit 1; end if;
    if v_prod is null then
      select id into v_prod from produits where pharmacy_id = p and lower(nom) = lower(v_nom) and lower(coalesce(presentation, '')) = lower(coalesce(v_pres, '')) limit 1;
    end if;
    if v_prod is null then
      if v_limite then
        select count(*) into v_nb from produits where pharmacy_id = p;
        if v_nb >= 1500 then raise exception 'La formule Petite officine est limitée à 1 500 références (ligne %). Passez à la formule Officine pour des références illimitées.', l->>'ligne'; end if;
      end if;
      insert into produits (pharmacy_id, nom, presentation, rayon_id, fournisseur_id, prix_vente, prix_achat, seuil, codes)
      values (p, v_nom, v_pres, v_ray, v_four, coalesce(v_pv, 0), coalesce(v_pa, 0), nullif(l->>'seuil', '')::int,
              case when v_code is null then '{}'::text[] else array[v_code] end)
      returning id into v_prod;
      crees := crees + 1;
    else
      update produits set
        prix_vente = case when p_maj_prix and v_pv is not null then v_pv else prix_vente end,
        prix_achat = case when p_maj_prix and v_pa is not null then v_pa else prix_achat end,
        rayon_id = coalesce(rayon_id, v_ray), fournisseur_id = coalesce(fournisseur_id, v_four),
        presentation = coalesce(presentation, v_pres),
        codes = case when v_code is not null and not (v_code = any(codes)) then codes || v_code else codes end
      where id = v_prod;
      maj := maj + 1;
    end if;

    -- stock : un lot par ligne (le même lot et la même date s'additionnent)
    if v_q > 0 then
      v_exp := nullif(l->>'peremption', '')::date;
      if v_exp is null then raise exception 'Ligne % : date de péremption manquante pour du stock', l->>'ligne'; end if;
      if v_exp < current_date then perimes := perimes + 1;
      else
        perform ajouter_lot(p, v_prod, coalesce(nullif(trim(left(l->>'lot', 40)), ''), 'IMPORT'), v_exp, v_q);
        lots_ok := lots_ok + 1; boites := boites + v_q;
      end if;
    end if;
  end loop;
  return jsonb_build_object('lignes', n, 'crees', crees, 'mis_a_jour', maj, 'lots', lots_ok, 'boites', boites, 'perimes_ignores', perimes,
                            'rayons_crees', rayons_crees, 'grossistes_crees', fours_crees);
end $$;

revoke all on function public.importer_produits(uuid,jsonb,boolean) from public, anon;
grant execute on function public.importer_produits(uuid,jsonb,boolean) to authenticated;
