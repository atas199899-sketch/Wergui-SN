-- Tests locaux (base jetable) : psql -v ON_ERROR_STOP=1 -f stub_supabase.sql -f ../migrations/001_init.sql -f tests.sql
\set QUIET on
insert into auth.users (id,email) values
 ('00000000-0000-0000-0000-00000000000a','titulaire@ex.sn'),
 ('00000000-0000-0000-0000-00000000000b','vendeur@ex.sn'),
 ('00000000-0000-0000-0000-00000000000c','autre@ex.sn');
create or replace function pg_temp.en_tant_que(u text) returns void language plpgsql as
$$ begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('role','authenticated',false); end $$;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as
$$ begin if not c then raise exception 'ÉCHEC : %', msg; end if; raise notice 'OK : %', msg; end $$;
create or replace function pg_temp.echoue(sql text, msg text) returns void language plpgsql as
$$ begin begin execute sql; exception when others then raise notice 'OK : % (refusé : %)', msg, sqlerrm; return; end; raise exception 'ÉCHEC : % aurait dû être refusé', msg; end $$;

-- Titulaire crée sa pharmacie
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.creer_pharmacie('Pharmacie Test','Dakar','33 000 00 00','Dr Test') as p \gset
select pg_temp.ok((select count(*) from rayons where pharmacy_id=:'p')=9,'9 rayons par défaut');
select pg_temp.ok((select count(*) from fournisseurs where pharmacy_id=:'p')=4,'4 grossistes par défaut');
insert into produits (pharmacy_id,nom,presentation,prix_vente,prix_achat,codes) values (:'p','Paracétamol 500 mg','boîte de 16',600,420,'{03400934507786}') returning id as prod \gset
select public.ajouter_lot(:'p',:'prod','a1',current_date+10,5) as lot_court \gset
select public.ajouter_lot(:'p',:'prod','B2',current_date+300,20) as lot_long \gset
select public.ajouter_lot(:'p',:'prod','A1',current_date+10,3);
select pg_temp.ok((select quantite from lots where id=:'lot_court')=8,'même lot regroupé (5+3), numéro mis en majuscules');
select pg_temp.echoue(format('select public.ajouter_lot(%L,%L,''X'',current_date-1,1)',:'p',:'prod'),'lot périmé refusé à l''entrée');
-- un lot périmé déjà en stock (inséré directement par l'admin pour le test)
reset role; insert into lots (pharmacy_id,produit_id,numero,peremption,quantite) values (:'p',:'prod','OLD',current_date-5,4) returning id as lot_old \gset
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');

-- Vente FEFO
select public.enregistrer_vente(:'p',('[{"produit_id":"'||:'prod'||'","quantite":10}]')::jsonb,'Espèces',0,null) as v \gset
select pg_temp.ok((select quantite from lots where id=:'lot_court')=0 and (select quantite from lots where id=:'lot_long')=18,'FEFO : le lot court sort en premier');
select pg_temp.ok((select quantite from lots where id=:'lot_old')=4,'lot périmé jamais vendu');
select pg_temp.ok((select total from ventes where id=:'v')=6000,'total calculé en base (10 x 600)');
select pg_temp.echoue(format('select public.enregistrer_vente(%L,''[{"produit_id":"%s","quantite":99}]'',''Espèces'',0,null)',:'p',:'prod'),'stock insuffisant refusé');
select public.enregistrer_vente(:'p',('[{"produit_id":"'||:'prod'||'","quantite":1}]')::jsonb,'Assurance',10,'CMU') as v2 \gset
select pg_temp.ok((select total=540 and part_assurance=432 from ventes where id=:'v2'),'remise 10 % et tiers payant 80 %');
select pg_temp.echoue(format('select public.enregistrer_vente(%L,''[{"produit_id":"%s","quantite":1}]'',''Bitcoin'',0,null)',:'p',:'prod'),'moyen de paiement non accepté refusé');

-- Équipe : vendeur
select public.ajouter_membre(:'p','VENDEUR@ex.sn','Moussa','vendeur','{"per":true,"recep":true}');
select pg_temp.echoue(format('select public.ajouter_membre(%L,''inconnu@ex.sn'',''X'',''vendeur'',''{}'')',:'p'),'e-mail sans compte refusé');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from produits)=1,'le vendeur voit les produits de sa pharmacie');
update produits set prix_vente=1 where id=:'prod';
select pg_temp.ok((select prix_vente from produits where id=:'prod')=600,'vendeur : modification de prix sans effet');
select pg_temp.echoue(format('select public.enregistrer_vente(%L,''[{"produit_id":"%s","quantite":1}]'',''Espèces'',5,null)',:'p',:'prod'),'vendeur : remise refusée');
select public.enregistrer_vente(:'p',('[{"produit_id":"'||:'prod'||'","quantite":1}]')::jsonb,'Wave',0,null);
select pg_temp.echoue(format('update lots set quantite=999 where id=%L',:'lot_long'),'quantité modifiable seulement par les fonctions');
update lots set prioritaire=true where id=:'lot_long';
select pg_temp.ok((select prioritaire from lots where id=:'lot_long'),'vendeur peut marquer un lot prioritaire');
select public.sortir_lot(:'lot_old','retrait');
select pg_temp.ok((select quantite from lots where id=:'lot_old')=0 and (select valeur from mouvements where lot_id=:'lot_old' and type='retrait')=1680,'retrait du lot périmé (4 x 420 F)');
select pg_temp.echoue(format('select public.ajuster_inventaire(%L,%L,5)',:'p',:'prod'),'vendeur sans droit inventaire refusé');
select pg_temp.echoue(format('select public.creer_commande(%L,(select id from fournisseurs limit 1),''[]'')',:'p'),'vendeur sans droit commandes refusé');
update pharmacies set nom='Pirate' where id=:'p';
select pg_temp.ok((select nom from pharmacies where id=:'p')='Pharmacie Test','vendeur : modification de la pharmacie sans effet');

select pg_temp.echoue('select prix_achat from produits','vendeur : lecture directe des prix d''achat refusée');
select pg_temp.ok((select count(*) from public.couts_achat(:'p'))=0,'vendeur : aucun prix d''achat par la fonction');
select pg_temp.ok((select count(*) from produits where nom like 'Parac%')=1,'vendeur : lit toujours le catalogue (sans prix d''achat)');
select pg_temp.echoue(format('select public.est_membre(%L)',:'p'),'fonctions de contrôle plus appelables depuis l''API (schéma privé)');
-- Autre utilisateur : ne voit rien
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from produits)=0 and (select count(*) from pharmacies)=0 and (select count(*) from ventes)=0,'une autre personne ne voit rien de la pharmacie');
select pg_temp.echoue(format('insert into produits (pharmacy_id,nom) values (%L,''X'')',:'p'),'une autre personne ne peut rien ajouter');
select pg_temp.echoue(format('select public.enregistrer_vente(%L,''[{"produit_id":"%s","quantite":1}]'',''Espèces'',0,null)',:'p',:'prod'),'une autre personne ne peut pas vendre');
select public.creer_pharmacie('Sa propre pharmacie','Thiès','','Dr Autre') as p2 \gset
select pg_temp.ok((select count(*) from pharmacies)=1,'elle ne voit que sa propre pharmacie');

-- Titulaire : inventaire, commande, réception, désactivation
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select prix_achat from public.couts_achat(:'p') limit 1)=420,'titulaire : voit les prix d''achat');
select public.ajuster_inventaire(:'p',:'prod',15) as ecart \gset
select pg_temp.ok(:ecart=-1 and (select sum(quantite) from lots where produit_id=:'prod')=15,'inventaire : 16 en stock, 15 comptés, écart -1 corrigé');
select public.creer_commande(:'p',(select id from fournisseurs where pharmacy_id=:'p' and nom='Laborex'),('[{"produit_id":"'||:'prod'||'","quantite":30}]')::jsonb) as c \gset
select public.receptionner_commande(:'c',jsonb_build_array(jsonb_build_object('produit_id',:'prod','quantite',30,'numero','R9','peremption',(current_date+400)::text))) as n \gset
select pg_temp.ok(:n=30 and (select statut from commandes where id=:'c')='recue','réception : 30 boîtes entrées');
select pg_temp.echoue(format('select public.receptionner_commande(%L,''[]'')',:'c'),'double réception refusée');
select public.modifier_membre(:'p','00000000-0000-0000-0000-00000000000b','Moussa','vendeur','{}',false);
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from produits)=0,'vendeur désactivé : plus aucun accès');

-- Formules et abonnement
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select pg_temp.echoue(format('update pharmacies set formule=''officine'', statut=''actif'' where id=%L',:'p'),'le titulaire ne peut pas changer lui-même sa formule');
select pg_temp.echoue('select * from public.admin_pharmacies()','console réservée aux administrateurs');
select pg_temp.echoue(format('select public.admin_definir_abonnement(%L,''officine'',''actif'',null)',:'p'),'seul un administrateur active une formule');
reset role; insert into public.wergui_admins values ('00000000-0000-0000-0000-00000000000a');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok(public.suis_admin(),'administrateur reconnu');
select pg_temp.ok((select count(*) from public.admin_pharmacies())=2,'la console liste les pharmacies');
select public.admin_definir_abonnement(:'p','petite','actif',current_date+30);
select pg_temp.echoue(format('select public.enregistrer_vente(%L,''[{"produit_id":"%s","quantite":1}]'',''Assurance'',0,''CMU'')',:'p',:'prod'),'Petite officine : tiers payant refusé');
select public.modifier_membre(:'p','00000000-0000-0000-0000-00000000000b','Moussa','vendeur','{"inv":true,"cmd":true}',true);
reset role; select pg_temp.ok((select droits from membres where user_id='00000000-0000-0000-0000-00000000000b')='{"per":true,"recep":true}'::jsonb,'Petite officine : droits remis au modèle du rôle');
insert into auth.users (id,email) values ('00000000-0000-0000-0000-00000000000d','second@ex.sn');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select pg_temp.echoue(format('select public.ajouter_membre(%L,''second@ex.sn'',''Awa'',''vendeur'',''{}'')',:'p'),'Petite officine : un seul membre en plus du titulaire');
select public.admin_definir_abonnement(:'p','officine','actif',current_date+30);
select public.ajouter_membre(:'p','second@ex.sn','Awa','vendeur','{"inv":true}');
reset role; select pg_temp.ok((select (droits->>'inv')::boolean from membres where user_id='00000000-0000-0000-0000-00000000000d'),'Officine : équipe illimitée et droits personnalisés');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.admin_definir_abonnement(:'p','officine','suspendu',null);
select pg_temp.echoue(format('select public.enregistrer_vente(%L,''[{"produit_id":"%s","quantite":1}]'',''Espèces'',0,null)',:'p',:'prod'),'abonnement suspendu : ventes bloquées');
select pg_temp.ok((select count(*) from produits where pharmacy_id=:'p')>=1,'abonnement suspendu : les données restent consultables');
select public.admin_definir_abonnement(:'p','officine','actif',current_date+30);

-- Compte et pharmacie : suppression, transfert
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000c');
select pg_temp.echoue('select public.supprimer_mon_compte(false)','titulaire seul : suppression du compte refusée sans décision sur la pharmacie');
select pg_temp.echoue(format('select public.supprimer_pharmacie(%L,''Mauvais nom'')',:'p2'),'suppression de pharmacie refusée si le nom ne correspond pas');
select pg_temp.echoue(format('select public.supprimer_pharmacie(%L,''Pharmacie Test'')',:'p'),'impossible de supprimer la pharmacie d''un autre');
select public.supprimer_mon_compte(true);
reset role;
select pg_temp.ok((select count(*) from auth.users where id='00000000-0000-0000-0000-00000000000c')=0 and (select count(*) from pharmacies where id=:'p2')=0,'compte et pharmacie supprimés ensemble');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.modifier_membre(:'p','00000000-0000-0000-0000-00000000000b','Moussa','vendeur','{}',true);
select pg_temp.echoue(format('select public.transferer_titulaire(%L,%L)',:'p','00000000-0000-0000-0000-00000000000a'),'transfert à soi-même refusé');
select public.transferer_titulaire(:'p','00000000-0000-0000-0000-00000000000b');
select public.supprimer_mon_compte(false);
reset role;
select pg_temp.ok((select role from membres where user_id='00000000-0000-0000-0000-00000000000b')='titulaire','transfert : Moussa devient titulaire');
select pg_temp.ok((select count(*) from auth.users where id='00000000-0000-0000-0000-00000000000a')=0,'ancien titulaire peut supprimer son compte après le transfert');
select pg_temp.ok((select count(*) from ventes where pharmacy_id=:'p')>=3 and (select count(*) from ventes where pharmacy_id=:'p' and user_id is null)>=2,'ventes conservées (sans nom) après suppression du vendeur');
reset role;
\echo TOUS LES TESTS SONT PASSÉS
