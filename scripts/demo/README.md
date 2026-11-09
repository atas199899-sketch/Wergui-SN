# Pharmacie de démonstration

Crée sur Supabase une pharmacie complète pour les démonstrations : 214 médicaments et produits courants au Sénégal
(130 avec leur vrai code CIP, reconnus au scanner), lots et dates de péremption, 30 jours de ventes, alertes,
commandes, caisse, dépenses, bordereau d'assurance et factures grossistes. Équipe : titulaire, adjointe et deux vendeurs
sans e-mail (connexion par code PIN sur le poste).

1. `compte.py` : crée le compte titulaire, la pharmacie et l'équipe (écrit `compte.json`, à ne jamais publier).
2. `donnees.py` : génère les fichiers SQL (produits, lots, ventes, activité) à exécuter dans l'ordre.

Les codes CIP viennent de `medicaments.json` (base publique des médicaments), via `codes.json`.
