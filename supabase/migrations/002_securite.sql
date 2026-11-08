-- Wergui SN : renforcement de la sécurité
-- 1. Les fonctions de contrôle d'accès passent dans un schéma privé (non exposé par l'API).
-- 2. Les prix d'achat ne sont lisibles que par les membres qui ont le droit « achat ».

create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.est_membre(uuid) set schema private;
alter function public.est_titulaire(uuid) set schema private;
alter function public.a_droit(uuid, text) set schema private;
alter function private.est_membre(uuid) set search_path = public, private;
alter function private.est_titulaire(uuid) set search_path = public, private;
alter function private.a_droit(uuid, text) set search_path = public, private;
revoke all on function private.est_membre(uuid), private.est_titulaire(uuid), private.a_droit(uuid, text) from public, anon;
grant execute on function private.est_membre(uuid), private.est_titulaire(uuid), private.a_droit(uuid, text) to authenticated;

alter function public.creer_pharmacie(text,text,text,text)               set search_path = public, private;
alter function public.ajouter_membre(uuid,text,text,text,jsonb)          set search_path = public, private, auth;
alter function public.modifier_membre(uuid,uuid,text,text,jsonb,boolean) set search_path = public, private;
alter function public.ajouter_lot(uuid,uuid,text,date,int)               set search_path = public, private;
alter function public.enregistrer_vente(uuid,jsonb,text,int,text)        set search_path = public, private;
alter function public.sortir_lot(uuid,text)                              set search_path = public, private;
alter function public.ajuster_inventaire(uuid,uuid,int)                  set search_path = public, private;
alter function public.creer_commande(uuid,uuid,jsonb)                    set search_path = public, private;
alter function public.receptionner_commande(uuid,jsonb)                  set search_path = public, private;

-- Prix d'achat : colonne retirée de la lecture directe
revoke select on public.produits from authenticated, anon;
grant select (id, pharmacy_id, nom, presentation, rayon_id, fournisseur_id, prix_vente, seuil, codes, actif, created_at)
  on public.produits to authenticated;
revoke select on public.vente_lignes from authenticated, anon;
grant select (id, vente_id, pharmacy_id, produit_id, lot_id, quantite, prix_unitaire, created_at)
  on public.vente_lignes to authenticated;

-- ... et lisible seulement avec le droit « achat » (titulaire, adjoint, ou droit donné)
create or replace function public.couts_achat(p uuid) returns table (id uuid, prix_achat int)
language sql stable security definer set search_path = public, private as $$
  select pr.id, pr.prix_achat from produits pr where pr.pharmacy_id = p and a_droit(p, 'achat')
$$;
revoke all on function public.couts_achat(uuid) from public, anon;
grant execute on function public.couts_achat(uuid) to authenticated;
