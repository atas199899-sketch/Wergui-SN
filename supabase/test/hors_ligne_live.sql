-- Vérification des ventes hors ligne sur le vrai projet (annulée à la fin).
do $$
declare t uuid := gen_random_uuid(); p uuid; pr uuid; c uuid := gen_random_uuid(); r jsonb; ok text := ''; ko text := '';
begin
  insert into auth.users (id, email, aud, role) values (t, 'test-hl-' || t || '@exemple.invalid', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t::text, true);
  set local role authenticated;
  p := public.creer_pharmacie('Pharmacie Test HL', 'Dakar', '', 'Dr Test');
  insert into public.produits (pharmacy_id, nom, prix_vente) values (p, 'Produit test', 500) returning id into pr;
  perform public.ajouter_lot(p, pr, 'L1', current_date + 100, 3);
  r := public.enregistrer_vente_hors_ligne(p, c, jsonb_build_array(jsonb_build_object('produit_id', pr, 'quantite', 2)), 'Espèces', 0, null, now() - interval '1 hour', true);
  r := public.enregistrer_vente_hors_ligne(p, c, jsonb_build_array(jsonb_build_object('produit_id', pr, 'quantite', 2)), 'Espèces', 0, null, now(), true);
  if (select count(*) from public.ventes where pharmacy_id = p) = 1 and (r->>'deja')::boolean then ok := ok || 'renvoi sans doublon; '; else ko := ko || 'doublon; '; end if;
  r := public.enregistrer_vente_hors_ligne(p, gen_random_uuid(), jsonb_build_array(jsonb_build_object('produit_id', pr, 'quantite', 3)), 'Espèces', 0, null, now(), true);
  if (r->>'manquant')::int = 2 then ok := ok || 'écart de stock signalé; '; else ko := ko || 'écart; '; end if;
  begin perform public.enregistrer_vente_hors_ligne(p, gen_random_uuid(), jsonb_build_array(jsonb_build_object('produit_id', pr, 'quantite', 1)), 'Espèces', 0, null, now(), false);
    ko := ko || 'vente en ligne sans stock acceptée; ';
  exception when others then ok := ok || 'vente en ligne sans stock refusée; '; end;
  reset role;
  raise exception 'RESULTAT|OK=%|ECHECS=%', ok, coalesce(nullif(ko, ''), 'aucun');
end $$;
