-- Vérification de sécurité sur un vrai projet Supabase, sans rien laisser derrière :
-- tout se passe dans un bloc qui se termine par une exception (donc annulé).
do $$
declare
  t uuid := gen_random_uuid(); v uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  p uuid; p2 uuid; prod uuid; n int; ok text := ''; ko text := '';
  procedure_ok text;
begin
  insert into auth.users (id, email, aud, role) values (t, 'test-titulaire-' || t || '@exemple.invalid', 'authenticated', 'authenticated'),
    (v, 'test-vendeur-' || v || '@exemple.invalid', 'authenticated', 'authenticated'),
    (x, 'test-autre-' || x || '@exemple.invalid', 'authenticated', 'authenticated');

  -- titulaire
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t::text, true);
  set local role authenticated;
  p := public.creer_pharmacie('Pharmacie Test Sécurité', 'Dakar', '', 'Dr Test');
  insert into public.produits (pharmacy_id, nom, prix_vente, prix_achat) values (p, 'Produit test', 1000, 700) returning id into prod;
  perform public.ajouter_lot(p, prod, 'L1', current_date + 200, 10);
  perform public.ajouter_membre(p, 'test-vendeur-' || v || '@exemple.invalid', 'Vendeur test', 'vendeur', '{"recep":true}');
  if (select prix_achat from public.couts_achat(p) limit 1) = 700 then ok := ok || 'titulaire voit ses prix d''achat; '; else ko := ko || 'titulaire prix d''achat; '; end if;

  -- vendeur
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  set local role authenticated;
  select count(*) into n from public.produits; if n = 1 then ok := ok || 'vendeur voit le catalogue; '; else ko := ko || 'vendeur catalogue (' || n || '); '; end if;
  begin perform prix_achat from public.produits limit 1; ko := ko || 'vendeur LIT les prix d''achat; '; exception when insufficient_privilege then ok := ok || 'vendeur ne lit pas les prix d''achat; '; end;
  select count(*) into n from public.couts_achat(p); if n = 0 then ok := ok || 'fonction prix d''achat vide pour le vendeur; '; else ko := ko || 'couts_achat vendeur; '; end if;
  update public.produits set prix_vente = 1 where id = prod;
  begin perform public.enregistrer_vente(p, jsonb_build_array(jsonb_build_object('produit_id', prod, 'quantite', 1)), 'Espèces', 10, null); ko := ko || 'vendeur fait une remise; ';
  exception when others then ok := ok || 'remise refusée au vendeur; '; end;
  perform public.enregistrer_vente(p, jsonb_build_array(jsonb_build_object('produit_id', prod, 'quantite', 1)), 'Espèces', 0, null);
  begin update public.lots set quantite = 999; ko := ko || 'vendeur modifie les quantités; '; exception when insufficient_privilege then ok := ok || 'quantités protégées; '; end;
  begin perform private.est_membre(p); ok := ok || ''; exception when others then null; end;

  -- personne extérieure
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', x::text, true);
  set local role authenticated;
  select count(*) into n from public.produits; if n = 0 then ok := ok || 'extérieur ne voit aucun produit; '; else ko := ko || 'extérieur voit des produits; '; end if;
  select count(*) into n from public.pharmacies; if n = 0 then ok := ok || 'extérieur ne voit aucune pharmacie; '; else ko := ko || 'extérieur voit une pharmacie; '; end if;
  select count(*) into n from public.ventes; if n = 0 then ok := ok || 'extérieur ne voit aucune vente; '; else ko := ko || 'extérieur voit des ventes; '; end if;
  select count(*) into n from public.membres; if n = 0 then ok := ok || 'extérieur ne voit pas l''équipe; '; else ko := ko || 'extérieur voit l''équipe; '; end if;
  begin insert into public.produits (pharmacy_id, nom) values (p, 'Intrus'); ko := ko || 'extérieur ajoute un produit; '; exception when others then ok := ok || 'extérieur ne peut rien ajouter; '; end;
  begin perform public.enregistrer_vente(p, jsonb_build_array(jsonb_build_object('produit_id', prod, 'quantite', 1)), 'Espèces', 0, null); ko := ko || 'extérieur vend; ';
  exception when others then ok := ok || 'extérieur ne peut pas vendre; '; end;
  begin perform public.ajouter_membre(p, 'test-autre-' || x || '@exemple.invalid', 'Intrus', 'adjoint', '{}'); ko := ko || 'extérieur s''ajoute à l''équipe; ';
  exception when others then ok := ok || 'extérieur ne peut pas s''ajouter à l''équipe; '; end;
  update public.pharmacies set nom = 'Piratée' where id = p;

  -- utilisateur non connecté (anon)
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin select count(*) into n from public.produits; if n = 0 then ok := ok || 'visiteur non connecté ne voit rien; '; else ko := ko || 'anon voit des produits; '; end if;
  exception when insufficient_privilege then ok := ok || 'visiteur non connecté refusé; '; end;
  begin perform public.creer_pharmacie('X', '', '', ''); ko := ko || 'anon crée une pharmacie; '; exception when others then ok := ok || 'visiteur ne peut pas créer de pharmacie; '; end;

  reset role;
  if (select nom from public.pharmacies where id = p) <> 'Pharmacie Test Sécurité' then ko := ko || 'nom de pharmacie modifié par un extérieur; '; else ok := ok || 'pharmacie intacte; '; end if;
  if (select prix_vente from public.produits where id = prod) <> 1000 then ko := ko || 'prix modifié par le vendeur; '; else ok := ok || 'prix intact; '; end if;

  raise exception 'RESULTAT|OK=%|ECHECS=%', ok, coalesce(nullif(ko, ''), 'aucun');
end $$;
