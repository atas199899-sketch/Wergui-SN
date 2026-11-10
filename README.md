# Wergui SN – gestion de stock pour les pharmacies du Sénégal

- Site en ligne : https://werguisn.pages.dev (l'ancienne adresse GitHub Pages redirige vers celle-ci ; elle sert encore la base des médicaments).
- `index.html` : page d'accueil.
- `app/` : l'application (inscription, connexion, stock, caisse, scanner, péremptions, commandes, inventaire, équipe, paramètres), reliée à Supabase.
- `demo/` : démo cliquable, sans compte (données d'exemple).
- `supabase/migrations/` : schéma de la base, règles de sécurité (RLS) et fonctions.
- `supabase/test/` : tests SQL et faux Supabase local pour les tests de bout en bout.

## Mise en service

1. Créer un projet Supabase et exécuter dans l'ordre les fichiers `supabase/migrations/001_init.sql` à `013_import.sql` (SQL Editor ou API).
   Puis déployer la fonction serveur `supabase/functions/pin` (connexion par code PIN sur le poste), sans vérification JWT : `supabase functions deploy pin --no-verify-jwt`.
2. Renseigner `app/config.js` avec l'URL du projet et la clé « anon public ».
3. Dans Supabase → Authentication → URL Configuration, mettre l'adresse du site (`…/Wergui-SN/app/`) comme Site URL et URL de redirection.

## Tests

```
psql -d test -f supabase/test/stub_supabase.sql $(for f in supabase/migrations/00*.sql; do echo -f $f; done) -f supabase/test/tests.sql
```

La base des médicaments (`medicaments.json`) est construite par GitHub Actions à partir de la Base de données publique des médicaments (France).
