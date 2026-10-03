# Authentification, utilisateurs et social (A1–A5)

L'API est documentée sur `/docs`. Les requêtes protégées utilisent
`Authorization: Bearer <accessToken>`. Dans Swagger, coller uniquement l'access
token dans **Authorize**. Les champs des requêtes POST/PATCH ci-dessous sont du
JSON, sauf le token de vérification envoyé dans l'URL.

## Configuration et migration

- `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET` : deux secrets distincts.
- `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` : `15m` / `7d` par défaut.
- `GOOGLE_AUTH_ENABLED` : `true` par défaut. Un `GOOGLE_CLIENT_ID` vide empêche
  alors le démarrage. Utiliser explicitement `false` en local sans client OAuth :
  les routes Google renvoient 503, la connexion par email reste disponible.
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` : requis pour utiliser Facebook ;
  ses routes renvoient 503 lorsqu'il n'est pas configuré.
- `APP_URL` : adresse utilisée dans les liens affichés par `MailService`.

`make` applique les migrations existantes. La migration `20260929120000_auth_users_social`
ajoute les sessions, les hashes des tokens de renouvellement/réinitialisation et
le statut des invitations. Elle convertit `musicPreferences` en liste de genres.
Les anciens tableaux JSON, ou le champ `genres` d'un objet JSON, sont normalisés ;
les autres formes deviennent une liste vide. Le JSON original est conservé dans
`_MusicPreferencesArchive`, sans exposition dans l'API.

Les anciens JWT sans identifiant de session (`sid`) sont rejetés : se reconnecter
après la mise à jour. Les anciennes invitations de collaborateurs/membres sont
marquées acceptées par la migration.

## Routes d'authentification

| Route | Corps / paramètres | Résultat |
|---|---|---|
| `POST /auth/register` | `email`, `password` (8 caractères minimum), `name` | Utilisateur sans hash ; ne connecte pas automatiquement |
| `GET /auth/verify-email?token=...` | Token de validation | Email validé |
| `POST /auth/resend-verification` | `email` | Réponse générique |
| `POST /auth/login` | `email`, `password` | `accessToken`, `refreshToken`, `user` |
| `POST /auth/refresh` | `refreshToken` | Nouveaux tokens et utilisateur |
| `POST /auth/logout` | Access token dans le header | Révoque la session courante |
| `POST /auth/forgot-password` | `email` | Réponse générique ; lien si le compte possède un mot de passe |
| `POST /auth/reset-password` | `token`, `newPassword` (8 caractères minimum) | Mot de passe changé, sessions révoquées |
| `POST /auth/google` | `idToken` du SDK Google | Connexion ou création du compte social |
| `POST /auth/facebook` | `accessToken` du SDK Facebook | Connexion ou création du compte social |
| `POST /auth/link/google` | `idToken` + access token Music Room dans le header | Lie Google au compte connecté |
| `POST /auth/link/facebook` | `accessToken` Facebook + access token Music Room dans le header | Lie Facebook au compte connecté |

Google vérifie systématiquement `aud` et `email_verified` ; Facebook vérifie
`debug_token` (`app_id`, validité, utilisateur), puis le profil. Un email déjà
présent ne provoque jamais une fusion automatique : la connexion sociale renvoie
409 et demande de se connecter au compte existant pour effectuer la liaison.
Les tokens des fournisseurs ne peuvent pas remplacer les JWT Music Room.

Chaque connexion crée une session en base. Les tokens de renouvellement sont
stockés sous forme de hashes SHA-256 et consommés à chaque renouvellement.
La réutilisation d'un token déjà consommé révoque **toutes** les sessions de
l'utilisateur, y compris leurs access tokens. Le client doit donc sérialiser
les renouvellements : deux appels simultanés avec le même token déclenchent
cette protection. Les hashes consommés restent en base pour détecter les rejeux.
Une nouvelle connexion crée une nouvelle session indépendante.

Les liens de réinitialisation expirent après 30 minutes et ne s'utilisent qu'une
fois. Une réinitialisation invalide aussi les autres liens encore actifs et
révoque toutes les sessions. La validation d'email expire après 24 heures.

`MailService` affiche toujours les liens dans les logs : le transport SMTP n'est
pas encore implémenté. Le lien de réinitialisation n'est pas une page web :
pour tester, copier son token dans le corps de `POST /auth/reset-password`.

## Amis

Toutes ces routes nécessitent une connexion.

| Route | Fonction |
|---|---|
| `POST /friends/requests` avec `{ "userId": "..." }` | Envoyer une demande |
| `GET /friends/requests` | Demandes en attente envoyées et reçues (`senderId` / `receiverId`) |
| `POST /friends/requests/:id/accept` | Accepter, destinataire uniquement |
| `POST /friends/requests/:id/reject` | Refuser, destinataire uniquement |
| `DELETE /friends/requests/:id` | Annuler, expéditeur uniquement |
| `GET /friends` | Lister les amis |
| `DELETE /friends/:id` | Retirer un ami, symétriquement |

Les demandes à soi-même sont rejetées (400), les doublons et demandes déjà
traitées renvoient 409. Une demande réciproque accepte automatiquement la demande
existante, y compris lorsque les deux envois arrivent en parallèle. Les mutations
verrouillent les deux utilisateurs dans un ordre stable et mettent à jour les
relations dans une même transaction.

## Profils et recherche

- `GET /users/me` / `PATCH /users/me` : profil du compte connecté.
- `GET /users/:id` : profil public sans connexion ; avec un access token valide,
  ajoute les informations autorisées pour le lecteur.
- `GET /users/search?q=Alice&genre=jazz` : recherche publique par nom et/ou genre.

| Lecteur | Champs renvoyés par `/users/:id` |
|---|---|
| Anonyme ou autre utilisateur | `id`, `name`, `publicInfo`, `musicPreferences` |
| Ami | Champs publics + `friendsOnlyInfo` |
| Propriétaire | Son profil complet, dont `privateInfo`, sans `passwordHash` |

Les listes d'amis et les recherches renvoient uniquement les champs publics.
Elles ne révèlent ni email, ni identifiants sociaux, ni informations privées.
Un header d'authentification invalide sur `/users/:id` renvoie 401.

`musicPreferences` est maintenant un tableau de chaînes, par exemple
`["jazz", "rock"]`. Les genres sont convertis en minuscules, sans espaces aux
extrémités ; les doublons sont rejetés. Maximum : 50 genres de 1 à 50 caractères.
Les anciens objets JSON ne sont plus acceptés par `PATCH /users/me`.

## Invitations

L'invitation reste créée par les routes propriétaires existantes :
`POST /parties/:id/invite` et `POST /playlists/:id/invite`, avec `{ "userId": "..." }`.
Ces deux routes renvoient désormais un objet **Invitation**, dont l'`id` sert à
répondre, et non le profil du membre ou la playlist.

| Route | Fonction |
|---|---|
| `GET /invitations/me` | Invitations reçues, en attente ou acceptées |
| `POST /invitations/:id/accept` | Accepter et devenir membre/collaborateur |
| `POST /invitations/:id/decline` | Refuser une invitation en attente |
| `DELETE /parties/:id/invitations/:userId` | Propriétaire : retirer invitation et membre |
| `DELETE /playlists/:id/invitations/:userId` | Propriétaire : retirer invitation et collaborateur |

Les listes `/parties` et `/playlists` comprennent les ressources publiques, celles
possédées et les ressources privées pour lesquelles une invitation est active
(`PENDING` ou `ACCEPTED`). Une invitation refusée ou révoquée ne donne aucun accès
privé. `/mine` liste les ressources possédées ou rejointes, pas les simples
invitations en attente. `POST /parties/:id/join` accepte aussi une invitation en
attente ; une party privée exige une invitation.

L'acceptation donne le rôle de collaborateur pour une playlist `INVITED_ONLY`.
La licence `EVERYONE` reste accessible aux utilisateurs autorisés à voir la
ressource. Retirer une invitation ne bannit pas quelqu'un d'une ressource publique.
Le propriétaire peut réinviter après un refus ou un retrait.

## Appareils, logs et pagination

`DELETE /devices/:id` supprime uniquement un appareil du compte connecté ; un
appareil inexistant ou appartenant à quelqu'un d'autre renvoie 404. Les logs ne
rattachent `X-Device-Id` que si l'appareil appartient à l'utilisateur authentifié.
Un identifiant étranger/inconnu est ignoré pour le rattachement, sans bloquer
l'action. Les paramètres d'URL et les tokens de vérification ne sont pas copiés
dans le nom de l'action.

Les listes acceptent `page` (1 par défaut) et `limit` (20 par défaut, maximum 100) :
amis, demandes, recherche, invitations, appareils, parties, playlists, files de
morceaux et morceaux de playlist. Les réponses restent des tableaux, sans total.
L'ordre est stable grâce à un second tri par identifiant. Une page/limite invalide
renvoie 400.

## Vérification

```bash
# Tests unitaires dans le backend déjà démarré
docker compose exec backend npm test -- --runInBand

# Intégration : schéma jetable dans la base, jamais de reset/truncate de public
# Le rôle de test doit pouvoir créer des schémas.
docker compose exec backend sh -c 'TEST_DATABASE_URL="$DATABASE_URL" npm run test:e2e'
```

Pour une base de test séparée, fournir sa propre `TEST_DATABASE_URL` au processus
Jest. Chaque exécution crée un schéma `musicroom_test_<uuid>`, applique les vraies
migrations, lance une application Nest sur un port éphémère et supprime seulement
ce schéma à la fin. Les services de mail et les réponses des fournisseurs sociaux
sont simulés ; les guards JWT, Prisma et PostgreSQL sont réels. Les validations
des réponses Google/Facebook sont couvertes séparément par les tests unitaires.
Le limiteur de requêtes est désactivé uniquement dans le processus des tests
fonctionnels pour permettre la création des comptes nécessaires.

La suite couvre la rotation/revocation, les resets concurrents, les collisions
sociales, les demandes d'amitié simultanées, les filtres de profils, les invitations
et le rattachement/suppression des appareils. Elle ne remplace pas un test réel
avec les SDK et identifiants Google/Facebook de l'application.
