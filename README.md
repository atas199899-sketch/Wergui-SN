# Wergui SN – gestion de stock pour les pharmacies du Sénégal

- Site en ligne : https://werguisn.pages.dev (et https://atas199899-sketch.github.io/Wergui-SN/).
- `index.html` : page d'accueil.
- `app/` : l'application (inscription, connexion, stock, caisse, scanner, péremptions, commandes, inventaire, équipe, paramètres), reliée à Supabase.
- `demo/` : démo cliquable, sans compte (données d'exemple).
- `supabase/migrations/` : schéma de la base, règles de sécurité (RLS) et fonctions.
- `supabase/test/` : tests SQL et faux Supabase local pour les tests de bout en bout.

## Mise en service

1. Créer un projet Supabase et exécuter `supabase/migrations/001_init.sql` (SQL Editor ou API).
2. Renseigner `app/config.js` avec l'URL du projet et la clé « anon public ».
3. Dans Supabase → Authentication → URL Configuration, mettre l'adresse du site (`…/Wergui-SN/app/`) comme Site URL et URL de redirection.

## Tests

```
psql -d test -f supabase/test/stub_supabase.sql -f supabase/migrations/001_init.sql -f supabase/test/tests.sql
```

La base des médicaments (`medicaments.json`) est construite par GitHub Actions à partir de la Base de données publique des médicaments (France).
