# Music Room — API

Backend NestJS + Prisma + PostgreSQL : base de données, authentification,
logs d'action, et les deux services **Music Track Vote** (`parties`) et
**Music Playlist Editor** (`playlists`).

## Démarrage rapide

```bash
cd music-room-api               # depuis la racine du dépôt
cp .env.example .env            # première installation uniquement
# Configurer .env (voir ci-dessous), puis démarrer Docker Desktop / Docker Engine.
make                           # construit, applique les migrations, démarre l'API
make logs                      # suit les logs du backend
```

Documentation Swagger générée automatiquement : http://localhost:3000/docs

## Configuration

Éditez `.env` (également créé automatiquement par `make` s’il est absent, à partir de
`.env.example`) :
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` : configuration PostgreSQL.
- `DATABASE_URL` : URL Prisma, avec l'hôte `postgres` depuis Docker. Les identifiants
  de l'URL doivent être encodés si le mot de passe contient des caractères réservés.
  Dans ce cas, remplacer l'interpolation du modèle par l'URL correctement encodée ;
  conserver le mot de passe brut dans `POSTGRES_PASSWORD`.
- Un volume PostgreSQL existant conserve ses identifiants : changer `.env` ne
  change pas le mot de passe déjà enregistré en base.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` : à changer avant tout déploiement
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` : depuis
  https://developers.facebook.com/apps
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` : depuis
  https://console.cloud.google.com/apis/credentials

Sans client OAuth Google en développement, ajouter `GOOGLE_AUTH_ENABLED=false`
dans `.env`. Les routes de connexion et de liaison Google renvoient alors 503 ;
l'authentification par email reste disponible. Par défaut, Google est activé et
l'absence de `GOOGLE_CLIENT_ID` empêche le démarrage. Après modification de `.env`,
recréer le backend avec `docker compose up -d --no-deps --force-recreate backend`.

Le service mail affiche actuellement les liens dans les logs. Renseigner
`MAIL_HOST` ne suffit pas : un vrai transport SMTP reste à implémenter.

Routes, comportement de sécurité, pagination, migrations et tests A1–A5 :
[guide authentification et utilisateurs](docs/AUTH-USERS.md).

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
