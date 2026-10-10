# Facebook Login — configuration et tests

## Configuration du backend

Renseigner `FACEBOOK_CLIENT_ID` (App ID) et `FACEBOOK_CLIENT_SECRET` dans `.env`.
Le secret reste uniquement côté backend. Ne jamais le placer dans le mobile,
les captures d’écran ou les fichiers versionnés.

Après modification de `.env` :

```sh
docker compose up -d --no-deps --force-recreate backend
```

Sans ces paramètres, les routes Facebook renvoient 503.

## Obtenir un token utilisateur pour un test manuel

1. Dans Meta Developers, choisir l’application Sonora.
2. Dans **Cas d’utilisation → Facebook Login → Personnaliser**, activer `email`
   en plus de `public_profile` pour les tests.
3. Dans l’Explorateur de l’API Graph, sélectionner **Sonora** et **Token utilisateur**.
4. Sélectionner `email`, puis générer un nouveau token et accepter les autorisations.
5. Exécuter `GET /me/permissions` : `email` et `public_profile` doivent être accordées.
6. Exécuter `GET /me?fields=id,name,email` et vérifier la présence des trois champs.

Sélectionner une permission dans l’explorateur ne modifie pas un token déjà créé.
Si l’email reste absent, vérifier les autorisations accordées et l’adresse confirmée
sur le compte Facebook. Le backend rejette un profil sans email ; il n’en invente pas.

## Tester dans Swagger

`POST /auth/facebook` reçoit le **token utilisateur Facebook** :

```json
{ "accessToken": "TOKEN_UTILISATEUR_FACEBOOK" }
```

- Nouvel email : création du compte et retour des tokens Sonora.
- Identité Facebook déjà liée : connexion au même utilisateur.
- Email d’un compte existant mais identité non liée : 409, sans fusion automatique.

Pour le cas 409 : se connecter au compte Sonora existant, coller son **access token
Sonora** dans **Authorize**, puis appeler `POST /auth/link/facebook` avec le token
utilisateur Facebook dans le corps JSON. Refaire ensuite `POST /auth/facebook` :
l’identifiant Sonora doit rester identique.

Un token Facebook n’est pas un JWT Sonora : il ne doit pas être utilisé dans
**Authorize** pour appeler `/users/me` ou les autres routes protégées.

## Contrôles du fournisseur

Le backend interroge `debug_token` et vérifie la validité, l’application destinataire,
l’identifiant utilisateur et les expirations fournies. Le profil `/me` doit appartenir
au même utilisateur et contenir un email non vide.

Point à distinguer : `debug_token` valide l’identité Facebook et l’application,
pas la possession de la boîte mail. Notre requête `/me` ne récupère aucun
indicateur `email_verified`. Actuellement, `createFromSocial` remplit pourtant
`emailVerifiedAt` pour Google et Facebook. Cette hypothèse Facebook reste à
remplacer par une vérification Sonora de l’adresse, ou à justifier par une
garantie actuelle du fournisseur ; elle n’a pas été confirmée lors de la revue.
Le refus de fusion automatique avec un compte existant reste en place.

- Token rejeté, autre application, utilisateur incohérent ou email absent : 401.
- Meta indisponible, délai dépassé, HTTP 429/5xx ou JSON illisible : 503 générique.
- Token vide ou supérieur à 16 384 caractères dans le corps de la route : 400.

Les détails d’erreur réseau, les réponses brutes Meta et les tokens ne sont pas
recopiés dans les erreurs renvoyées par le fournisseur.

## État des tests au 6 octobre 2026

- Liaison explicite puis connexion au compte existant, sans doublon : confirmées
  manuellement par l’utilisatrice avec un vrai token Facebook.
- Création d’un nouveau compte, identité stable, collisions et isolation des sessions :
  couvertes par les tests d’intégration, avec le fournisseur simulé.
- Contrôles des réponses Meta, expirations et pannes : tests unitaires, sans appel réel.
- SDK natif Android/iOS : reste à intégrer et tester dans le projet mobile.

## Publication reportée

Sonora reste non publiée. Les tests en mode développement sont réservés aux comptes
ayant un rôle sur l’application (administrateur, développeur ou testeur).
Les personnes invitées doivent accepter leur rôle.
Voir le [guide de test Facebook Login](https://supabase.com/docs/guides/auth/social-login/auth-facebook#testing-your-integration).

Le contrôle Meta, les informations de confidentialité et la procédure de suppression
restent à finaliser avant une ouverture publique selon les exigences du tableau de bord.
Les fichiers `../../sonora-legal/` sont des brouillons locaux, pas des pages publiées.
