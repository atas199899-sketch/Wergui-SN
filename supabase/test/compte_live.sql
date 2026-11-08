-- Vérification sur le vrai projet (annulée à la fin) : formules, administration, suppression de compte.
do $$
declare t uuid := gen_random_uuid(); v uuid := gen_random_uuid(); p uuid; prod uuid; ok text := ''; ko text := '';
begin
  insert into auth.users (id, email, aud, role) values (t, 'test-t-' || t || '@exemple.invalid', 'authenticated', 'authenticated'),
    (v, 'test-v-' || v || '@exemple.invalid', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t::text, true);
  set local role authenticated;
  p := public.creer_pharmacie('Pharmacie Test Compte', 'Dakar', '', 'Dr Test');
  if (select statut from public.pharmacies where id = p) = 'essai' then ok := ok || 'nouvelle pharmacie en essai; '; else ko := ko || 'statut initial; '; end if;
  begin update public.pharmacies set statut = 'actif', formule = 'officine' where id = p; ko := ko || 'titulaire change sa formule; ';
  exception when insufficient_privilege then ok := ok || 'titulaire ne peut pas changer sa formule; '; end;
  begin perform * from public.admin_pharmacies(); ko := ko || 'console ouverte à un non-administrateur; ';
  exception when others then ok := ok || 'console fermée aux non-administrateurs; '; end;
  if not public.suis_admin() then ok := ok || 'pas administrateur par défaut; '; else ko := ko || 'administrateur par défaut; '; end if;
  begin perform * from public.wergui_admins; ko := ko || 'liste des administrateurs lisible; ';
  exception when insufficient_privilege then ok := ok || 'liste des administrateurs illisible; '; end;
  begin perform public.supprimer_mon_compte(false); ko := ko || 'titulaire seul supprime son compte sans décider; ';
  exception when others then ok := ok || 'titulaire seul doit décider du sort de la pharmacie; '; end;
  perform public.supprimer_mon_compte(true);
  reset role;
  if not exists (select 1 from auth.users where id = t) and not exists (select 1 from public.pharmacies where id = p) then
    ok := ok || 'suppression du compte et de la pharmacie effective sur Supabase; ';
  else ko := ko || 'suppression de compte; '; end if;
  raise exception 'RESULTAT|OK=%|ECHECS=%', ok, coalesce(nullif(ko, ''), 'aucun');
end $$;
