-- Wergui SN : pas de vente sans caisse ouverte (formule Officine et essai, là où la gestion de caisse existe).
-- Règle vérifiée par la base ; le titulaire peut la désactiver (réglage « caisse_obligatoire »).
-- Les ventes faites sans internet (envoyées après coup) ne sont pas bloquées : elles ont déjà eu lieu au comptoir.

create or replace function private.verif_caisse() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare ph pharmacies;
begin
  if coalesce(new.hors_ligne, false) then return new; end if;
  select * into ph from pharmacies where id = new.pharmacy_id;
  if not (ph.formule = 'officine' or ph.statut = 'essai') then return new; end if;
  if coalesce((ph.reglages->>'caisse_obligatoire')::boolean, true) = false then return new; end if;
  if not exists (select 1 from caisses where pharmacy_id = new.pharmacy_id and statut = 'ouverte') then
    raise exception 'Caisse fermée : ouvrez la caisse avant d''encaisser.';
  end if;
  return new;
end $$;
drop trigger if exists verif_caisse on public.ventes;
create trigger verif_caisse before insert on public.ventes for each row execute function private.verif_caisse();
