-- Vérification du code PIN sur le vrai projet (annulée à la fin).
do $$
declare t uuid := gen_random_uuid(); r jsonb; ok text := ''; ko text := '';
begin
  insert into auth.users (id, email, aud, role) values (t, 'test-pin-' || t || '@exemple.invalid', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t::text, true);
  set local role authenticated;
  begin perform public.definir_pin('0000'); ko := ko || 'PIN trivial accepté; '; exception when others then ok := ok || 'PIN trivial refusé; '; end;
  perform public.definir_pin('2580');
  if public.a_un_pin() then ok := ok || 'PIN enregistré; '; else ko := ko || 'PIN enregistré; '; end if;
  if (public.verifier_pin('2580')->>'ok')::boolean then ok := ok || 'bon PIN; '; else ko := ko || 'bon PIN; '; end if;
  if (public.verifier_pin('1397')->>'reste')::int = 4 then ok := ok || 'mauvais PIN compté; '; else ko := ko || 'mauvais PIN; '; end if;
  begin perform * from private.pins; ko := ko || 'table des PIN lisible; '; exception when insufficient_privilege then ok := ok || 'table des PIN illisible; '; end;
  reset role;
  if (select hash like '$2%' from private.pins where user_id = t) then ok := ok || 'PIN haché en bcrypt; '; else ko := ko || 'hachage; '; end if;
  raise exception 'RESULTAT|OK=%|ECHECS=%', ok, coalesce(nullif(ko, ''), 'aucun');
end $$;
