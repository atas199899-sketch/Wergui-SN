-- Vérification du module Finances sur le vrai projet (annulée à la fin).
do $$
declare t uuid := gen_random_uuid(); p uuid; e int; ok text := ''; ko text := '';
begin
  insert into auth.users (id, email, aud, role) values (t, 'test-f-' || t || '@exemple.invalid', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t::text, true);
  set local role authenticated;
  p := public.creer_pharmacie('Pharmacie Test Finances', 'Dakar', '', 'Dr Test');
  perform public.ouvrir_caisse(p, 10000);
  begin perform public.ouvrir_caisse(p, 0); ko := ko || 'deux caisses ouvertes; ';
  exception when others then ok := ok || 'une seule caisse ouverte; '; end;
  insert into public.depenses (pharmacy_id, libelle, montant) values (p, 'Test', 700);
  if public.caisse_attendue(p) = 9300 then ok := ok || 'espèces attendues (fond - dépense); '; else ko := ko || 'espèces attendues; '; end if;
  e := public.fermer_caisse(p, 9000);
  if e = -300 then ok := ok || 'écart de clôture renvoyé au titulaire; '; else ko := ko || 'écart de clôture; '; end if;
  if (select count(*) from public.avoirs_grossistes(p)) = 4 then ok := ok || 'avoirs par grossiste; '; else ko := ko || 'avoirs; '; end if;
  if (select depenses = 700 and resultat = -700 from public.resultat_mois(p, current_date)) then ok := ok || 'résultat du mois; '; else ko := ko || 'résultat du mois; '; end if;
  begin perform public.creer_bordereau(p, 'IPM'); ko := ko || 'bordereau vide créé; ';
  exception when others then ok := ok || 'bordereau vide refusé; '; end;
  reset role;
  update public.pharmacies set formule = 'petite', statut = 'actif' where id = p;
  set local role authenticated;
  begin perform public.ouvrir_caisse(p, 0); ko := ko || 'caisse ouverte en Petite officine; ';
  exception when others then ok := ok || 'caisse réservée à la formule Officine; '; end;
  reset role;
  raise exception 'RESULTAT|OK=%|ECHECS=%', ok, coalesce(nullif(ko, ''), 'aucun');
end $$;
