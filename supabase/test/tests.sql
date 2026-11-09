-- Tests locaux (base jetable) : psql -v ON_ERROR_STOP=1 -f stub_supabase.sql -f ../migrations/00*.sql -f tests.sql
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

-- Invitations par lien
reset role;
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000e','awa@ex.sn','{"nom":"Awa Sarr"}');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select pg_temp.echoue(format('select public.creer_invitation(%L,''X'',''vendeur'',''{}'')',:'p'),'seul le titulaire crée une invitation');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.creer_invitation(:'p','','vendeur','{"per":true}') as inv \gset
select pg_temp.ok(length(:'inv')=16,'code d''invitation de 16 caractères');
reset role; set role anon;
select pg_temp.ok((public.voir_invitation(:'inv')->>'pharmacie')='Pharmacie Test','sans compte : on voit seulement la pharmacie et le rôle');
select pg_temp.ok(not (public.voir_invitation('inconnu')->>'ok')::boolean,'code inconnu refusé');
select pg_temp.echoue('select * from invitations','sans compte : liste des invitations illisible');
reset role;
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000e');
select pg_temp.ok((select count(*) from invitations)=0,'un autre compte ne voit pas les invitations');
select public.accepter_invitation(:'inv','');
reset role;
select pg_temp.ok((select nom='Awa Sarr' and role='vendeur' and (droits->>'per')::boolean from membres where user_id='00000000-0000-0000-0000-00000000000e'),'invitation acceptée : Awa rejoint l''équipe avec le rôle choisi');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000c');
select pg_temp.echoue(format('select public.accepter_invitation(%L,'''')',:'inv'),'lien à usage unique');
reset role;
update invitations set expire_le = now() - interval '1 day', utilisee_le = null, utilisee_par = null where code = :'inv';
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000c');
select pg_temp.echoue(format('select public.accepter_invitation(%L,'''')',:'inv'),'lien expiré refusé');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.creer_invitation(:'p','Test','stagiaire','{}') as inv2 \gset
select public.annuler_invitation((select id from invitations where code=:'inv2'));
select pg_temp.ok(not (public.voir_invitation(:'inv2')->>'ok')::boolean,'invitation annulée');
reset role;
delete from membres where user_id='00000000-0000-0000-0000-00000000000e';


-- Ventes hors ligne
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select sum(quantite) as st0 from lots where produit_id=:'prod' and peremption>=current_date \gset
select public.enregistrer_vente_hors_ligne(:'p','11111111-1111-1111-1111-111111111111',('[{"produit_id":"'||:'prod'||'","quantite":2}]')::jsonb,'Espèces',0,null,now()-interval '2 hours',true) as hl1 \gset
select pg_temp.ok((select hors_ligne and created_at < now()-interval '1 hour' and total=1200 from ventes where client_id='11111111-1111-1111-1111-111111111111'),'vente hors ligne enregistrée à l''heure réelle');
select public.enregistrer_vente_hors_ligne(:'p','11111111-1111-1111-1111-111111111111',('[{"produit_id":"'||:'prod'||'","quantite":2}]')::jsonb,'Espèces',0,null,now(),true) as hl2 \gset
select pg_temp.ok((select count(*) from ventes where client_id='11111111-1111-1111-1111-111111111111')=1 and (select sum(quantite) from lots where produit_id=:'prod' and peremption>=current_date)=:st0-2,'renvoi de la même vente : comptée une seule fois');
select public.enregistrer_vente_hors_ligne(:'p','22222222-2222-2222-2222-222222222222',('[{"produit_id":"'||:'prod'||'","quantite":'||(:st0+1)||'}]')::jsonb,'Wave',0,null,now(),true) as hl3 \gset
select pg_temp.ok((:'hl3'::jsonb->>'manquant')::int=3 and (select count(*) from vente_lignes l join ventes v on v.id=l.vente_id where v.client_id='22222222-2222-2222-2222-222222222222' and l.stock_manquant)=1,'stock épuisé entre-temps : vente gardée, écart signalé');
select public.enregistrer_vente_hors_ligne(:'p','33333333-3333-3333-3333-333333333333',('[{"produit_id":"'||:'prod'||'","quantite":1}]')::jsonb,'Espèces',0,null,now()+interval '3 days',true);
select pg_temp.ok((select created_at <= now() from ventes where client_id='33333333-3333-3333-3333-333333333333'),'date dans le futur ramenée à maintenant');
select pg_temp.echoue(format('select public.enregistrer_vente_hors_ligne(%L,gen_random_uuid(),''[{"produit_id":"%s","quantite":1}]'',''Espèces'',10,null,now(),true)',:'p',:'prod'),'hors ligne : la remise reste soumise au droit');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000c');
select pg_temp.echoue(format('select public.enregistrer_vente_hors_ligne(%L,gen_random_uuid(),''[]'',''Espèces'',0,null,now(),true)',:'p'),'hors ligne : pharmacie d''un autre refusée');
reset role;
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select pg_temp.echoue(format('select public.enregistrer_vente_hors_ligne(%L,gen_random_uuid(),''[{"produit_id":"%s","quantite":500}]'',''Espèces'',0,null,now(),false)',:'p',:'prod'),'vente en ligne : stock insuffisant refusé');
reset role;
-- remettre du stock pour la suite des tests
update lots set quantite = quantite + 5 where id = :'lot_long';


-- Finances (formule Officine)
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.ouvrir_caisse(:'p',10000) as caisse \gset
select pg_temp.echoue(format('select public.ouvrir_caisse(%L,0)',:'p'),'une seule caisse ouverte à la fois');
insert into depenses (pharmacy_id,libelle,categorie,montant) values (:'p','Carburant livraison','Transport',500);
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select public.enregistrer_vente(:'p',('[{"produit_id":"'||:'prod'||'","quantite":1}]')::jsonb,'Espèces',0,null);
select public.enregistrer_vente(:'p',('[{"produit_id":"'||:'prod'||'","quantite":1}]')::jsonb,'Wave',0,null);
select pg_temp.ok(public.caisse_attendue(:'p') is null,'vendeur : montant attendu caché (clôture à l''aveugle)');
select pg_temp.ok((select count(*) from caisses where statut='ouverte')=1,'vendeur : voit que la caisse est ouverte');
select pg_temp.ok((select count(*) from depenses)=0 and (select count(*) from factures)=0,'vendeur : dépenses et factures invisibles');
select pg_temp.echoue(format('insert into depenses (pharmacy_id,libelle,montant) values (%L,''x'',1)',:'p'),'vendeur : saisie de dépense refusée');
select pg_temp.echoue(format('select * from public.resultat_mois(%L,current_date)',:'p'),'vendeur : résultat du mois refusé');
select pg_temp.echoue(format('select public.creer_bordereau(%L,''CMU'')',:'p'),'vendeur : bordereau refusé');
select pg_temp.ok(public.fermer_caisse(:'p',10000) is null,'vendeur : clôture sans voir l''écart');
reset role;
select pg_temp.ok((select attendu=10100 and ecart=-100 from caisses where id=:'caisse'),'caisse : attendu = fond + espèces - dépenses (10 000 + 600 - 500), écart -100');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.ouvrir_caisse(:'p',5000);
select pg_temp.ok(public.caisse_attendue(:'p')=5000,'titulaire : voit le montant attendu');
select pg_temp.ok(public.fermer_caisse(:'p',5200)=200,'titulaire : écart renvoyé à la clôture');
-- assurances
select public.creer_bordereau(:'p','CMU') as bord \gset
select pg_temp.ok((select montant from bordereaux where id=:'bord')=432 and (select bordereau_id from ventes where id=:'v2')=:'bord','bordereau CMU : 432 F, vente rattachée');
select pg_temp.echoue(format('select public.creer_bordereau(%L,''CMU'')',:'p'),'pas de second bordereau pour les mêmes ventes');
select public.maj_bordereau(:'bord',current_date,400);
select pg_temp.echoue(format('select public.maj_bordereau(%L,null,100)',:'bord'),'encaissement au-delà du montant refusé');
select pg_temp.ok((select paye=400 and envoye_le=current_date from bordereaux where id=:'bord'),'bordereau envoyé et encaissé en partie');
-- grossistes
select id as fact, montant as fmont from factures where commande_id=:'c' \gset
select pg_temp.ok(:fmont=12600,'facture créée à la réception (30 x 420 F)');
reset role; update produits set fournisseur_id=(select fournisseur_id from commandes where id=:'c') where id=:'prod';
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.sortir_lot(:'lot_long','retour');
select disponible as dispo from public.avoirs_grossistes(:'p') where fournisseur_id=(select fournisseur_id from commandes where id=:'c') \gset
select pg_temp.ok(:dispo>0,'avoir disponible après un retour grossiste');
select pg_temp.echoue(format('select public.payer_facture(%L,0,%s)',:'fact',:dispo+1),'avoir au-delà du disponible refusé');
select public.payer_facture(:'fact',1000,:dispo);
select pg_temp.echoue(format('select public.payer_facture(%L,99999,0)',:'fact'),'paiement au-delà du reste refusé');
select pg_temp.ok((select paye=1000+:dispo and avoir_utilise=:dispo from factures where id=:'fact'),'facture payée en partie avec l''avoir');
select pg_temp.ok((select disponible from public.avoirs_grossistes(:'p') where fournisseur_id=(select fournisseur_id from commandes where id=:'c'))=0,'avoir consommé');
-- résultat
select pg_temp.ok((select ventes>0 and depenses=500 and resultat=marge-pertes-depenses from public.resultat_mois(:'p',current_date)),'résultat du mois calculé en base');
-- formule Petite officine
select public.admin_definir_abonnement(:'p','petite','actif',current_date+30);
select pg_temp.echoue(format('select public.ouvrir_caisse(%L,0)',:'p'),'Petite officine : caisse réservée à la formule Officine');
select pg_temp.echoue(format('insert into depenses (pharmacy_id,libelle,montant) values (%L,''x'',1)',:'p'),'Petite officine : dépenses réservées à la formule Officine');
select public.admin_definir_abonnement(:'p','officine','actif',current_date+30);
reset role;

-- Code PIN
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(not public.a_un_pin(),'pas de PIN par défaut');
select pg_temp.echoue('select public.definir_pin(''12a4'')','PIN non numérique refusé');
select pg_temp.echoue('select public.definir_pin(''1111'')','PIN trop facile refusé');
select public.definir_pin('2580');
select pg_temp.ok(public.a_un_pin(),'PIN enregistré');
select pg_temp.ok((public.verifier_pin('2580')->>'ok')::boolean,'bon PIN accepté');
select pg_temp.ok((public.verifier_pin('0000')->>'reste')::int=4,'mauvais PIN : 4 essais restants');
select public.verifier_pin('0001'); select public.verifier_pin('0002'); select public.verifier_pin('0003');
select pg_temp.ok((public.verifier_pin('0004')->>'bloque_min')::int=15,'5 erreurs : PIN bloqué 15 minutes');
select pg_temp.ok(not (public.verifier_pin('2580')->>'ok')::boolean,'PIN bloqué même avec le bon code');
reset role;
select pg_temp.ok((select hash not like '%2580%' from private.pins limit 1),'PIN stocké haché');
select pg_temp.echoue('set role authenticated; select * from private.pins','table des PIN illisible');
reset role;
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((public.verifier_pin('2580')->>'aucun')::boolean,'le PIN d''un autre ne sert à rien');
reset role;

-- Paiement de l'abonnement (version manuelle)
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000c');
select pg_temp.echoue('select public.admin_config(''770000000'','''','''',null)','seul un administrateur règle les numéros');
select pg_temp.echoue(format('select public.declarer_paiement(%L,''officine'',1,''Wave'',null)',:'p'),'impossible de déclarer pour la pharmacie d''un autre');
select public.declarer_paiement(:'p2','officine',12,'Wave','TX-123') as pay \gset
select pg_temp.ok((select montant from paiements where id=:'pay')=250000,'montant calculé en base (12 mois = 10 x 25 000 F)');
select pg_temp.echoue(format('select public.declarer_paiement(%L,''petite'',1,''Wave'',null)',:'p2'),'un seul paiement en attente');
select pg_temp.echoue(format('select public.admin_traiter_paiement(%L,true,null)',:'pay'),'le titulaire ne valide pas lui-même');
select pg_temp.echoue(format('insert into paiements (pharmacy_id,formule,mois,montant,moyen) values (%L,''officine'',12,1,''Wave'')',:'p2'),'insertion directe refusée');
select pg_temp.ok((select count(*) from paiements)=1,'le titulaire voit ses paiements');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from paiements)=0,'un vendeur ne voit pas les paiements des autres');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select pg_temp.echoue('select public.admin_config(''77 000 00 00'','''','''',''https://pirate.example/pay'')','lien de paiement non Wave refusé');
select public.admin_config('77 000 00 00','','Wergui SN','https://pay.wave.com/m/M_sn_TEST/c/sn/');
select pg_temp.ok((select wave_numero from wergui_config)='77 000 00 00','numéro Wave réglé par l''administrateur');
select pg_temp.echoue('select public.admin_config_om(''https://faux.example/mp/x'',''1234'','''')','lien Orange Money non officiel refusé');
select public.admin_config_om('https://sugu.orange-sonatel.com/mp/TEST123','78 85 97 45','Test');
select pg_temp.ok((select om_code from wergui_config)='78 85 97 45','lien et code Orange Money enregistrés');
select public.admin_traiter_paiement(:'pay',true,'Reçu') as fin \gset
reset role;
select pg_temp.ok((select statut='actif' and formule='officine' and paye_jusqu=(current_date + interval '12 months')::date from pharmacies where id=:'p2'),'validation : Officine active pour 12 mois');
select pg_temp.echoue(format('select public.admin_traiter_paiement(%L,false,null)',:'pay'),'paiement déjà traité');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000c');
select public.declarer_paiement(:'p2','officine',1,'Orange Money',null) as pay2 \gset
select public.annuler_paiement(:'pay2');
select public.declarer_paiement(:'p2','officine',1,'Wave',null) as pay3 \gset
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.admin_traiter_paiement(:'pay3',true,null);
reset role;
select pg_temp.ok((select paye_jusqu=(current_date + interval '13 months')::date from pharmacies where id=:'p2'),'renouvellement : un mois ajouté à la suite');

-- Poste de la pharmacie : choisir son nom et taper son PIN
reset role;
insert into auth.users (id,email) values ('00000000-0000-0000-0000-00000000000f','m.test@membres.werguisn.invalid');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000b');
select pg_temp.echoue(format('select public.creer_poste(%L,''Comptoir'')',:'p'),'seul le titulaire déclare un poste');
select pg_temp.echoue(format('select public.membre_sans_email_creer(%L,''00000000-0000-0000-0000-00000000000a'',''00000000-0000-0000-0000-00000000000f'',''X'',''vendeur'',''3691'')',:'p'),'création de compte sans e-mail : jamais depuis l''application');
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.creer_poste(:'p','Comptoir') as jeton \gset
select pg_temp.ok(length(:'jeton')=48,'jeton secret du poste');
reset role; set role service_role;
select pg_temp.echoue(format('select public.membre_sans_email_creer(%L,''00000000-0000-0000-0000-00000000000b'',''00000000-0000-0000-0000-00000000000f'',''Ibou'',''vendeur'',''3691'')',:'p'),'seul le titulaire crée un compte sans e-mail');
select pg_temp.echoue(format('select public.membre_sans_email_creer(%L,''00000000-0000-0000-0000-00000000000a'',''00000000-0000-0000-0000-00000000000f'',''Ibou'',''vendeur'',''1111'')',:'p'),'PIN trop simple refusé à la création');
select public.membre_sans_email_creer(:'p','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000f','Ibou Fall','vendeur','3691');
reset role; set role anon;
select pg_temp.ok((public.poste_info(:'jeton')->'membres') @> '[{"nom":"Ibou Fall","pin":true}]','sur le poste, sans connexion : liste des membres');
select pg_temp.ok(not (public.poste_info('faux')->>'ok')::boolean,'faux jeton : rien n''est montré');
select pg_temp.echoue(format('select public.pin_connexion(%L,''00000000-0000-0000-0000-00000000000f'',''3691'')',:'jeton'),'connexion par PIN : jamais appelée directement depuis le navigateur');
reset role; set role service_role;
select pg_temp.ok((public.pin_connexion(:'jeton','00000000-0000-0000-0000-00000000000f','0000')->>'reste')::int=4,'mauvais PIN compté');
select pg_temp.ok((public.pin_connexion(:'jeton','00000000-0000-0000-0000-00000000000f','3691')->>'email')='m.test@membres.werguisn.invalid','bon PIN + jeton du poste : connexion accordée');
select pg_temp.ok(not (public.pin_connexion('faux','00000000-0000-0000-0000-00000000000f','3691')->>'ok')::boolean,'bon PIN sans le poste : refusé');
reset role;
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.definir_pin_membre(:'p','00000000-0000-0000-0000-00000000000f','4826');
select pg_temp.echoue(format('select public.definir_pin_membre(%L,''00000000-0000-0000-0000-00000000000b'',''4826'')',:'p'),'le titulaire ne choisit pas le PIN d''un compte avec e-mail');
reset role; set role service_role;
select pg_temp.ok((public.pin_connexion(:'jeton','00000000-0000-0000-0000-00000000000f','4826')->>'ok')::boolean,'nouveau PIN choisi par le titulaire');
reset role;
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.modifier_membre(:'p','00000000-0000-0000-0000-00000000000f','Ibou Fall','vendeur','{}',false);
reset role; set role service_role;
select pg_temp.ok(not (public.pin_connexion(:'jeton','00000000-0000-0000-0000-00000000000f','4826')->>'ok')::boolean,'membre désactivé : plus de connexion');
reset role;
select pg_temp.en_tant_que('00000000-0000-0000-0000-00000000000a');
select public.supprimer_poste((select id from postes where pharmacy_id=:'p'));
select pg_temp.ok(not (public.poste_info(:'jeton')->>'ok')::boolean,'poste retiré : liste plus affichée');
reset role;
delete from membres where user_id='00000000-0000-0000-0000-00000000000f';


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
