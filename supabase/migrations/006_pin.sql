-- Wergui SN : code PIN personnel pour changer rapidement d'utilisateur sur le poste partagé de la pharmacie.
-- Le PIN est stocké haché (bcrypt), jamais en clair ; 5 erreurs bloquent le PIN 15 minutes.

create table if not exists private.pins (
  user_id uuid primary key references auth.users on delete cascade,
  hash text not null,
  essais int not null default 0,
  bloque_jusqu timestamptz,
  modifie_le timestamptz not null default now()
);
revoke all on private.pins from public, anon, authenticated;

create or replace function public.definir_pin(p_pin text)
returns void language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then raise exception 'Le code PIN doit avoir 4 à 6 chiffres.'; end if;
  if p_pin ~ '^(.)\1+$' or p_pin in ('1234','12345','123456','4321','654321','0123','01234','012345') then
    raise exception 'Code trop facile à deviner : choisissez-en un autre.';
  end if;
  insert into private.pins (user_id, hash) values (auth.uid(), crypt(p_pin, gen_salt('bf', 8)))
  on conflict (user_id) do update set hash = excluded.hash, essais = 0, bloque_jusqu = null, modifie_le = now();
end $$;

-- Renvoie {"ok":true} ou {"ok":false,"reste":n} ou {"ok":false,"bloque_min":n}
create or replace function public.verifier_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, private, extensions as $$
declare r private.pins;
begin
  select * into r from private.pins where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'aucun', true); end if;
  if r.bloque_jusqu > now() then
    return jsonb_build_object('ok', false, 'bloque_min', ceil(extract(epoch from r.bloque_jusqu - now()) / 60));
  end if;
  if r.hash = crypt(coalesce(p_pin, ''), r.hash) then
    update private.pins set essais = 0, bloque_jusqu = null where user_id = auth.uid();
    return jsonb_build_object('ok', true);
  end if;
  if r.essais + 1 >= 5 then
    update private.pins set essais = 0, bloque_jusqu = now() + interval '15 minutes' where user_id = auth.uid();
    return jsonb_build_object('ok', false, 'bloque_min', 15);
  end if;
  update private.pins set essais = r.essais + 1 where user_id = auth.uid();
  return jsonb_build_object('ok', false, 'reste', 4 - r.essais);
end $$;

create or replace function public.a_un_pin()
returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.pins where user_id = auth.uid())
$$;

create or replace function public.supprimer_pin()
returns void language sql security definer set search_path = public, private as $$
  delete from private.pins where user_id = auth.uid()
$$;

revoke all on function public.definir_pin(text), public.verifier_pin(text), public.a_un_pin(), public.supprimer_pin() from public, anon;
grant execute on function public.definir_pin(text), public.verifier_pin(text), public.a_un_pin(), public.supprimer_pin() to authenticated;
