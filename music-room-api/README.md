# Music Room — API

Backend NestJS + Prisma + PostgreSQL : base de données, authentification,
logs d'action, et les deux services **Music Track Vote** (`parties`) et
**Music Playlist Editor** (`playlists`).

## Démarrage rapide

```bash
make install   # npm install + copie .env.example -> .env + prisma generate
make db        # démarre Postgres via Docker
make migrate   # applique le schéma Prisma sur la base
make dev       # démarre l'API en mode watch (http://localhost:3000)
```

Documentation Swagger générée automatiquement : http://localhost:3000/docs

## Configuration

Éditez `.env` (créé automatiquement par `make install` à partir de
`.env.example`) :
- `DATABASE_URL` : déjà prête pour le Postgres du `docker-compose.yml`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` : à changer avant tout déploiement
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` : depuis
  https://developers.facebook.com/apps
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` : depuis
  https://console.cloud.google.com/apis/credentials

Tant que `MAIL_HOST` n'est pas renseigné, les emails de vérification et de
réinitialisation de mot de passe sont simplement affichés dans les logs du
serveur (pratique en dev, à remplacer par un vrai transport SMTP en prod —
voir `src/mail/mail.service.ts`).

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
- Tests automatisés, ramp-up (k6/Apache Benchmark)



psql -h localhost -p 5432 -U nerrakeb -d postgres
CREATE USER musicroom WITH PASSWORD 'YOUR_PASSWORD';
CREATE DATABASE musicroom OWNER musicroom;