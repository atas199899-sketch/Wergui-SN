-- Wergui SN : lien de paiement marchand Wave (le montant est ajouté au lien par l'application).
alter table public.wergui_config add column if not exists wave_lien text
  check (wave_lien is null or wave_lien ~ '^https://pay\.wave\.com/m/[A-Za-z0-9_]+(/c/[a-z]{2})?/?$');

drop function if exists public.admin_config(text, text, text);
create or replace function public.admin_config(p_wave text, p_om text, p_beneficiaire text, p_wave_lien text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not private.est_admin() then raise exception 'Réservé aux administrateurs Wergui SN'; end if;
  if nullif(trim(p_wave_lien), '') is not null and trim(p_wave_lien) !~ '^https://pay\.wave\.com/m/[A-Za-z0-9_]+(/c/[a-z]{2})?/?$' then
    raise exception 'Lien Wave invalide : il doit commencer par https://pay.wave.com/m/';
  end if;
  update wergui_config set wave_numero = nullif(trim(p_wave), ''), om_numero = nullif(trim(p_om), ''),
    beneficiaire = nullif(trim(p_beneficiaire), ''), wave_lien = nullif(trim(p_wave_lien), ''), modifie_le = now() where id = 1;
end $$;
revoke all on function public.admin_config(text,text,text,text) from public, anon;
grant execute on function public.admin_config(text,text,text,text) to authenticated;
