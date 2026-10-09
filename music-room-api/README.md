# Music Room — API

Backend NestJS + Prisma + PostgreSQL : base de données, authentification,
logs d'action, et les deux services **Music Track Vote** (`parties`) et
**Music Playlist Editor** (`playlists`).

## Démarrage rapide

```bash
cd music-room-api               # depuis la racine du dépôt
# Démarrer Docker Desktop / Docker Engine.
make                           # construit, applique les migrations, démarre l'API
make logs                      # suit les logs du backend
```

Documentation Swagger générée automatiquement : http://localhost:3000/docs

Sur Windows, utiliser Docker Desktop avec les conteneurs Linux et installer
`make` pour le shell choisi (Git Bash ou PowerShell). La génération des secrets
omet le mapping UID/GID sous Windows. Sur Linux/macOS, elle utilise l’utilisateur
hôte ; le `.env` neuf reste en `0600`. Compose injecte les variables sans imposer
que l’utilisateur du backend puisse relire ce fichier. Voir [la note de sécurité](docs/SECURITY-AUTH.md).

PostgreSQL est publié uniquement sur `127.0.0.1:5432`. Remplacer le mot de passe
de développement du modèle avant tout déploiement. Les migrations Prisma assurent
l’initialisation du schéma ; aucun dossier `docker/postgres-init` n’est requis.

## Configuration

Éditez `.env` (créé automatiquement par `make` s’il est absent, à partir de
`.env.example`, avec deux secrets JWT aléatoires). Pour préparer la configuration
avant le premier démarrage, lancer `make .env`, puis éditer `.env` et lancer `make`.
Un fichier `.env` existant n’est jamais remplacé par `make` :
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` : configuration PostgreSQL.
- `DATABASE_URL` : URL Prisma, avec l'hôte `postgres` depuis Docker. Les identifiants
  de l'URL doivent être encodés si le mot de passe contient des caractères réservés.
  Dans ce cas, remplacer l'interpolation du modèle par l'URL correctement encodée ;
  conserver le mot de passe brut dans `POSTGRES_PASSWORD`.
- Un volume PostgreSQL existant conserve ses identifiants : changer `.env` ne
  change pas le mot de passe déjà enregistré en base.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` : obligatoires, distincts, au moins
  32 octets chacun, sans espaces ni valeurs d’exemple. L’API refuse de démarrer
  si ces contrôles échouent, y compris en développement. `make secrets` génère
  deux valeurs aléatoires sans les afficher, en conservant les autres paramètres.
  Recréer ensuite le backend ; tous les anciens JWT et liens de vérification/reset
  deviennent invalides. Voir [la configuration JWT](docs/SECURITY-AUTH.md#configuration-des-secrets-jwt).
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` : depuis
  https://developers.facebook.com/apps
- `GOOGLE_CLIENT_ID` : client OAuth **Application Web** depuis Google Cloud,
  identique au `webClientId` du SDK mobile. Aucun secret Google requis pour ce flux.
  Configuration et test navigateur : [guide Google Login](docs/GOOGLE-LOGIN.md).

Sans client OAuth Google en développement, ajouter `GOOGLE_AUTH_ENABLED=false`
dans `.env`. Les routes de connexion et de liaison Google renvoient alors 503 ;
l'authentification par email reste disponible. Par défaut, Google est activé et
l'absence de `GOOGLE_CLIENT_ID` empêche le démarrage. Après modification de `.env`,
recréer le backend avec `docker compose up -d --no-deps --force-recreate backend`.

Le service mail utilise `MAIL_TRANSPORT=log` en développement (liens dans les logs)
ou `MAIL_TRANSPORT=smtp` pour envoyer de vrais emails. Configuration Gmail,
vérification et premier envoi : [guide SMTP](docs/SMTP.md).

Routes, comportement de sécurité, pagination, migrations et tests A1–A5 :
[guide authentification et utilisateurs](docs/AUTH-USERS.md).
Tests Facebook et permissions : [guide Facebook Login](docs/FACEBOOK-LOGIN.md).
État de la partie auth/social et recette restante : [bilan](docs/AUTH-USERS-STATUS.md).
Protections et limites de déploiement : [note de sécurité](docs/SECURITY-AUTH.md).

## Vérification automatique

```sh
make lint                      # contrôle sans modifier les fichiers
make typecheck                 # vérification TypeScript
make test                      # tests unitaires
docker compose exec backend npm run build
docker compose exec backend npm run security:audit
docker compose exec backend sh -c 'TEST_DATABASE_URL="$DATABASE_URL" npm run test:e2e'
```

Le workflow [Backend CI](../.github/workflows/backend-ci.yml) exécute installation,
audit des dépendances de production, génération Prisma, lint, TypeScript, tests unitaires, compilation et tests d’intégration
sur les push vers `main` et les pull requests. Il utilise PostgreSQL jetable et les fournisseurs
sociaux simulés, sans secrets SMTP/OAuth. Le premier résultat GitHub sera disponible
après le push du workflow. Détails : [CI.md](docs/CI.md).

`make down` arrête les services en conservant les données. `make fclean` et
`make re` suppriment les volumes et les données PostgreSQL. Pour créer une
migration après une modification du schéma : `make migration name=nom_modification`.

## Routes principales

### Auth
| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/register` | Inscription email/mot de passe *(limité à 5/min)* |
| GET | `/auth/verify-email?token=...` | Validation de l'email |
| POST | `/auth/login` | Connexion (email vérifié requis) *(limité à 10/min)* |
| POST | `/auth/refresh` | Rafraîchir les tokens |
| POST | `/auth/forgot-password` / `/auth/reset-password` | Reset mot de passe |
| POST | `/auth/facebook` / `/auth/google` | Login via token du SDK mobile |
| POST | `/auth/link/facebook` / `/auth/link/google` | Lier un compte (JWT requis) |

### Utilisateurs & appareils
| Méthode | Route | Description |
|---|---|---|
| GET/PATCH | `/users/me` | Profil de l'utilisateur connecté |
| POST | `/devices` | Enregistrer l'appareil (à appeler au démarrage du mobile) |
| GET | `/devices` | Lister mes appareils |

> Envoyez le header `X-Device-Id` (reçu de `POST /devices`) sur vos requêtes
> pour que les logs d'action (V.6) soient rattachés au bon appareil.

### Music Track Vote (`/parties`)
| Méthode | Route | Description |
|---|---|---|
| POST | `/parties` | Créer un événement de vote |
| GET | `/parties` / `/parties/mine` | Événements publics / les miens |
| GET | `/parties/:id` | Détail (respecte la visibilité) |
| POST | `/parties/:id/invite` | Inviter un utilisateur (owner uniquement) |
| POST | `/parties/:id/join` | Rejoindre un événement |
| GET | `/parties/:id/queue` | File d'attente triée par votes |
| POST | `/parties/:id/songs` | Suggérer un morceau |
| POST/DELETE | `/parties/:id/songs/:partySongId/vote` | Voter / retirer son vote |

### Music Playlist Editor (`/playlists`)
| Méthode | Route | Description |
|---|---|---|
| POST | `/playlists` | Créer une playlist |
| GET | `/playlists` / `/playlists/mine` | Playlists publiques / les miennes |
| GET | `/playlists/:id` | Détail (respecte la visibilité) |
| POST | `/playlists/:id/invite` | Inviter un collaborateur (owner uniquement) |
| GET | `/playlists/:id/songs` | Morceaux triés par position |
| POST | `/playlists/:id/songs` | Ajouter un morceau |
| PATCH | `/playlists/:id/songs/:playlistSongId` | Déplacer (verrou optimiste, voir ci-dessous) |
| DELETE | `/playlists/:id/songs/:playlistSongId` | Retirer un morceau |

## Gestion de la concurrence

- **Votes** : contrainte `@@unique([partySongId, userId])` en base -> un
  double-vote simultané échoue au niveau SQL, pas seulement applicatif.
  L'incrément du compteur et la création du vote sont dans la même
  transaction Prisma.
- **Déplacement de playlist** : verrou optimiste. Le client envoie
  `expectedPosition` (la position qu'il a vue en dernier) ; si elle ne
  correspond plus à la position en base, l'API renvoie `409 Conflict` au
  lieu d'écraser silencieusement le changement concurrent d'un autre
  utilisateur. Le client doit alors rafraîchir avant de réessayer.

## Prochaines étapes (non encore implémentées)

- WebSocket Gateway (Socket.io) pour pousser en temps réel les votes/
  déplacements aux autres clients connectés (actuellement REST pur : il faut
  poller `/parties/:id/queue` et `/playlists/:id/songs`)
- Music Control Delegation (modèle `ControlDelegation` déjà en base)
- Compléter les tests des modules musique et les tests de charge (k6/Apache Benchmark)
