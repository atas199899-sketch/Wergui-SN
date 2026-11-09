-- Wergui SN : lien de paiement Orange Money (Max it) et code marchand.
alter table public.wergui_config add column if not exists om_lien text
  check (om_lien is null or om_lien ~ '^https://sugu\.orange-sonatel\.com/mp/[A-Za-z0-9]+$');
alter table public.wergui_config add column if not exists om_code text check (om_code is null or om_code ~ '^[0-9 ]{4,20}$');
alter table public.wergui_config add column if not exists om_nom text check (length(om_nom) <= 80);

create or replace function public.admin_config_om(p_lien text, p_code text, p_nom text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  if nullif(trim(p_lien), '') is not null and trim(p_lien) !~ '^https://sugu\.orange-sonatel\.com/mp/[A-Za-z0-9]+$' then
    raise exception 'Lien Orange Money invalide : il doit commencer par https://sugu.orange-sonatel.com/mp/';
  end if;
  if nullif(trim(p_code), '') is not null and trim(p_code) !~ '^[0-9 ]{4,20}$' then raise exception 'Code marchand invalide'; end if;
  update wergui_config set om_lien = nullif(trim(p_lien), ''), om_code = nullif(trim(p_code), ''), om_nom = nullif(trim(p_nom), ''), modifie_le = now() where id = 1;
end $$;
revoke all on function public.admin_config_om(text,text,text) from public, anon;
grant execute on function public.admin_config_om(text,text,text) to authenticated;
