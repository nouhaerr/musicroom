# État de la partie auth, utilisateurs et social

Point du 10 octobre 2026, limité aux commits, à la branche locale et aux tests décrits ci-dessous.
Le succès des tests automatisés ne vaut pas validation de toutes les configurations
de production ni du futur client mobile.

## Backend prévu dans le partage de travail

| Lot | État | Vérification |
|---|---|---|
| A1 Auth et sessions | Implémenté | Google/Facebook, liaison explicite, refresh en base, rotation, rejeu, logout, reset à usage unique |
| A2 Amis | Implémenté | Envoi, refus, annulation, acceptation, retrait, doublons et demandes réciproques concurrentes |
| A3 Profils et genres | Implémenté | Champs publics/amis/privés, recherche par nom et genre, filtrage des données sensibles |
| A4 Invitations | Implémenté | Acceptation/refus, visibilité des ressources privées, retrait et concurrence acceptation/retrait |
| A5 Appareils et logs | Implémenté | Vérification du propriétaire de `X-Device-Id`, suppression réservée au propriétaire |
| A12 Tests de ces modules | Présents | Tests unitaires et intégration PostgreSQL avec schémas jetables |
| A13 Pagination de ces modules | Implémentée | Bornes, pages distinctes, ordre stable, listes propres à l’utilisateur |
| A6 Délégation de contrôle | Non implémentée | Optionnelle dans le partage initial ; le modèle de données ne suffit pas à fournir le service |

## Tests manuels déjà confirmés par l’utilisatrice

- Inscription, réception de l’email réel, vérification et connexion.
- Réinitialisation : email reçu, token inutilisable après usage, ancien mot de passe
  refusé et nouveau mot de passe accepté.
- Google : nouveau compte, 409 pour un email existant, liaison explicite puis connexion.
- Facebook : 409 pour un email existant, liaison explicite puis connexion sans doublon.
- Sessions : après renouvellement puis rejeu de l’ancien refresh token, l’appel
  protégé renvoie 401 « Session expirée ou révoquée », confirmé manuellement.
  La révocation des autres sessions du même utilisateur est couverte automatiquement.
- Amis et profils : demande puis acceptation, informations réservées aux amis
  visibles uniquement après acceptation, puis masquées après retrait de l’amitié.
  Les informations privées restent absentes pour l’autre compte, confirmé manuellement.
- Invitations de playlists privées : invisibilité avant invitation, visibilité après
  invitation, acceptation et apparition dans `/playlists/mine`, puis perte d’accès
  et réponse 403 après retrait, confirmées manuellement.
- Appareils : création et présence dans la liste du propriétaire, absence dans la
  liste de l’autre compte, suppression par l’autre compte refusée (404), puis
  suppression par le propriétaire (200) et disparition de sa liste, confirmées
  manuellement dans Swagger. Le contrôle du rattachement des logs reste validé
  par les tests automatisés.
- Invitations de parties privées : invisibilité avant invitation, visibilité après
  invitation, acceptation et apparition dans `/parties/mine`, puis disparition des
  listes et réponse 403 après retrait, confirmées manuellement dans Swagger.

Les tests d’intégration simulent l’envoi de mail et les fournisseurs sociaux.
Ils utilisent les vrais guards JWT, Prisma, PostgreSQL et migrations.

Résultats de l’exécution du 7 octobre 2026 : **96 tests unitaires** et
**25 tests d’intégration/migration** réussis dans Docker après passage à NestJS 11,
Express 5, bcrypt 6 et Jest 30. Le lint `npm run lint`, la vérification TypeScript
`npm run typecheck` et la compilation réussissent également dans Docker.
L’image a été reconstruite avec `npm ci` et les volumes anonymes de dépendances
renouvelés. Deux tests supplémentaires vérifient les corps de requête et paramètres
Swagger, ainsi que la connexion avec un hash de mot de passe créé par bcrypt 5.1.1.
Le backend chargé utilise NestJS 11.2.7 et bcrypt 6.0.0 ; Swagger répond HTTP 200.

La validation des secrets JWT au démarrage est implémentée, sans secrets de secours.
Le générateur remplace uniquement les deux paramètres JWT, sans afficher leurs valeurs.
Le workflow GitHub Actions audit/lint/types/tests/build/intégration a réussi pour
`c74e20b` dans la PR #4 : [exécution du 8 octobre](https://github.com/nouhaerr/musicroom/actions/runs/37807903307).
Chaque étape du job backend est verte. Voir [CI.md](CI.md).
Les deux secrets JWT locaux ont été remplacés après accord de l’utilisatrice,
le backend recréé et la correspondance avec `.env` vérifiée sans afficher de secret.
Swagger répond HTTP 200. Les anciens tokens et liens doivent être remplacés.

## Bilan de la recette manuelle dans Swagger

Tous les parcours de la recette guidée ci-dessus ont été confirmés par l’utilisatrice.
Cette série est terminée pour le backend actuel. Les scénarios de concurrence,
de panne des fournisseurs, de pagination et de rattachement des logs sont couverts
par les tests automatisés ; ils ne sont pas tous déclarés testés manuellement.
Les tests natifs Android/iOS et les vérifications de production restent à faire.

Consulter [AUTH-USERS.md](AUTH-USERS.md) pour les routes et les corps attendus.

## Ce qui reste avant l’intégration mobile ou la production

- Frontend Expo : première base créée dans `music-room-mobile` sur `feat/mobile-auth` :
  écrans email, profil personnel modifiable, serveur configurable, stockage sécurisé,
  renouvellements sérialisés et enregistrement d’appareil après authentification.
  Recherche nom/genre, profils d’autrui et gestion des amis sont ajoutés dans la suite locale.
  Google natif (connexion et liaison) est ajouté le 10 octobre, en attente des clients
  natifs et de la recette réelle. TypeScript, 34 tests du client et export des bundles
  Android/iOS sont vérifiés localement ;
  les 21 contrôles `expo-doctor` passent après déduplication des dépendances.
  Recette réelle Android/iOS, configuration Google, SDK Facebook et écrans invitations/appareils
  restent à faire. Voir le [guide mobile](../../music-room-mobile/README.md).
- Vérifications et publication Meta : reportées ; les tests avec les rôles autorisés
  continuent. Les pages de `sonora-legal` restent à compléter et à héberger.
- Procédure effective de suppression des données : à définir et tester avant de
  publier les instructions correspondantes. Aucun endpoint de suppression de compte
  n’est annoncé comme implémenté par ce document.
- Mise en production : appliquer des secrets JWT aléatoires à chaque environnement,
  HTTPS et limitation des requêtes adaptée au proxy et aux instances ; voir
  [SECURITY-AUTH.md](SECURITY-AUTH.md). Les anciens secrets d’exemple sont maintenant refusés.
- Dépendances : l’audit de production ne signale plus de vulnérabilité connue après
  mise à jour. Suivre les 20 entrées modérées restantes dans les outils de test,
  liées à un avis sans correctif disponible ; voir la note de sécurité.
- Livrables : [justification technique](TECH-CHOICES.md) et [note d’usage de l’IA](AI-USAGE.md)
  préparées pour cette contribution. Relecture des auteurs, compléments musique/temps
  réel et tests de charge restent à coordonner.
- Swagger : les corps de requête sont documentés ; compléter les DTO de réponse
  et les exemples d’erreurs des routes auth/users/social (coordination A11).
- GitHub : CI backend verte ; règle de contrôle obligatoire avant fusion non configurée.
  Le workflow du nouveau mobile est inclus sur `feat/mobile-auth` ; son résultat
  sur GitHub reste à vérifier après le push.

Les fonctionnalités musique A8–A11 et leurs revues restent dans le périmètre de
l’autre développeur. Ce document ne confirme pas leur état sur les branches distantes.

## Complément du 11 octobre 2026

- Recette iOS confirmée par l’utilisatrice : l’email reste affiché après un login
  403 et le message disparaît après sept secondes.
- Notifications de succès/erreur traduites en anglais, expiration à sept secondes
  dans auth, profil et amis. La validation sous les champs reste visible.
- Facebook natif : boutons inscription/login et liaison explicite depuis le profil.
  iOS Limited Login vérifié via signature RS256/JWKS Meta, audience, issuer,
  expiration et nonce ; Android conserve debug_token et le contrôle d’identité.
  La recette réelle avec Meta et la validation Android restent à confirmer.
- Durées locales vérifiées : access 15 minutes, refresh 7 jours. Chaque rotation
  prolonge la session ; aucune limite absolue de durée n’est actuellement appliquée.
  Même règle côté serveur pour un client web ou mobile. Logout révoque une session ;
  reset et rejeu d’un refresh consommé révoquent toutes celles du compte.
- Ne pas assimiler les tests de logique mobile à des tests UI du simulateur.


## Profile/settings — 12 October 2026

- User confirmed the manual iOS authentication scenarios: Google/Facebook login,
  cancellation and explicit linking, restoration after closing the app, remaining
  signed out after logout, verification/reset links with the app closed.
- Profile screen follows `MobileDesign/Profile.png`: editable public name, display
  handle and bio; friends-only city and listening preference; private birthday;
  public genres and favorite artists; linked accounts; backend address; logout.
- Each editor PATCHes only its relevant section and preserves unrelated JSON keys.
  The handle is a display label, not a unique username or login identifier.
- Password accounts can request the existing reset email from Private information.
  Social-only accounts show that no password is set. No password-creation flow added.
- Authenticated `DELETE /auth/link/google` and `/auth/link/facebook` return the
  updated own profile. Removal retains existing sessions and requires another
  social provider or a password with a verified email. A row lock prevents concurrent
  removals from leaving the user without a sign-in method. Own profiles expose
  `hasPassword`, never the password hash.
- Listening activity is a stored preference only; live room sharing remains future
  work. Bottom navigation opens paginated, read-only account lists for rooms,
  playlists and devices. Full music editing/playback screens remain separate work.
- Validation: 344 backend unit tests, 29 auth/users integration tests in a disposable
  database schema, 54 mobile tests, both TypeScript checks, backend lint and iOS
  export passed. The top of the profile and navigation were inspected in the iOS
  simulator; new edit/unlink controls still need manual UI acceptance.

### Profile manual acceptance

1. Edit each section, save, leave the profile and return: verify persistence.
2. Inspect another user's profile as a friend and non-friend: private birthday/email
   must never appear; city is available only to friends.
3. Link Google/Facebook, then unlink one. Unlinking the last usable method must
   show an English error and keep the provider connected.
4. Request a password reset from Private information, follow the email and confirm
   existing sessions are revoked once the password changes.
5. Change the backend URL: confirm local configuration persists and you are signed out.
6. Check validation/error/success messages disappear after seven seconds; inspect
   all sections on a small screen and with larger accessibility text.


## Public profile photos — 12 October 2026

- Added authenticated PUT/DELETE `/users/me/avatar`, a bounded JPEG thumbnail,
  256px server re-encoding and metadata removal. Stored in `publicInfo.avatar`.
  The normal profile PATCH preserves the server's photo and ignores incoming
  avatar fields, preventing stale edits or bypassing the dedicated validator.
- Mobile: library picker/crop, replace/remove, initials fallback, photo display in
  profile and people screens. Native rebuild required for the new Expo modules.
- Validation: 351 backend unit tests and 55 mobile tests pass; the focused photo
  integration test passes against an isolated schema. Backend lint, both TypeScript
  checks, iOS JavaScript export and the native iOS build pass (0 errors). Real photo selection remains a manual test.
- UI acceptance steps and limitations: `music-room-mobile/docs/PROFILE.md`.


## Unique usernames and social password setup — 13 October 2026

- Optional `User.username` now has a unique index and lowercase ASCII format
  constraint (3–30 letters, numbers, underscores). PATCH normalizes it; competing
  claims return 409. Names and usernames are searchable. Email remains the login ID.
- Migration `20261012010000_unique_username` applied locally. It imports only valid,
  unambiguous legacy handles while retaining the original JSON for reference.
- Authenticated, throttled POST `/auth/password/setup` emails a single-use 30-minute
  password link to social-only users. Existing password accounts receive 409.
  Completion verifies the email, sets the hash and revokes every session. Social
  provider links are preserved. The token's email must still match the account.
- Mobile provides Create password, and the password-link form now works while
  signed in. The normal reset/login flows remain available.
- Validation: 351 unit tests, 34 auth/migration integration tests, 56 mobile tests;
  TypeScript and backend lint pass. Manual receipt/opening of the setup email and
  duplicate username feedback in the app remain acceptance checks.
