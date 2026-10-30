# Montée en charge (V.7)

Mesures du 30 octobre 2026, branche `feat/mandatory`. Le sujet demande de mesurer et de
justifier combien d'utilisateurs peuvent utiliser nos services en même temps, et de
préciser la machine utilisée.

## La machine

- Sur site (pas de cloud) : un PC portable.
- Processeur : Intel Core i7-11800H, 8 cœurs / 16 threads, 2,3 GHz.
- Mémoire : 15,7 Go.
- Windows 11 Home, Docker Engine 29.8.0 (Docker Desktop) ; sa machine virtuelle Linux
  dispose de 16 CPU et 7,6 Go.
- Dans Docker : l'API (Node 22.23.3, le conteneur de développement du projet,
  `npm run start:dev`) et PostgreSQL 16.15. L'API tourne dans un seul processus Node.
- Les outils de test tournent sur le même PC, en même temps que le serveur : les chiffres
  sont donc un minimum. Un serveur seul ferait mieux.

## Ce qui est mesuré

Nos 2 services : Music Track Vote (les salles) et Music Playlist Editor. Le sujet en
demande 2 sur 3 (V.2) : Music Control Delegation n'est pas fait.

1. **Le direct** : `scripts/ramp-up.ts <spectateurs>` crée des utilisateurs de test qui
   ouvrent tous la même salle publique en temps réel, comme la page d'une salle dans
   l'app. Puis 10 votes sont envoyés, un par seconde. Le script mesure le temps entre
   l'envoi d'un vote et sa réception par chaque spectateur. Les playlists utilisent le
   même code temps réel (même passerelle, mêmes instantanés regroupés toutes les 200 ms) :
   la mesure vaut pour les deux.
2. **Le chargement des pages** : `scripts/ramp-up.ts http` prépare 20 salles et
   20 playlists publiques (une page pleine dans l'app) et affiche 4 commandes `ab`
   (Apache Bench) prêtes à coller. Ce sont les requêtes que l'app envoie quand s'ouvrent
   Discover, une salle, l'onglet Playlists et une playlist. Chaque commande envoie
   2 000 requêtes, `-c` à la fois.

Chaque lancement supprime ses données de test à la fin, Ctrl+C compris.

## Quand un résultat est bon

Un résultat est **bon** si 95 % des réponses arrivent en moins de **1 seconde**
(p95 < 1 s) et si moins de 1 % des mises à jour ou des requêtes échouent. 1 seconde est
la limite au-delà de laquelle l'utilisateur perd le fil de ce qu'il fait
([Nielsen, *Response Times: The 3 Important Limits*](https://www.nngroup.com/articles/response-times-3-important-limits/)).

La limite retenue est la plus grande mesure encore bonne.

## Résultats : le direct

Une salle, 10 votes. « Par 100 » : 100 personnes ouvrent la salle au même moment, les
100 suivantes dès que celles-ci sont entrées. « Connexion » : le temps pour que tous les
spectateurs soient connectés et abonnés à la salle.

| Spectateurs | Arrivée | Connexion | Échecs | Mises à jour manquées | Médiane | p95 | Max | Bon |
|---|---|---|---|---|---|---|---|---|
| 500 | par 100 | 2,6 s | 0 | 0 % | 40 ms | 70 ms | 91 ms | ✅ |
| 1 000 | par 100 | 5,2 s | 0 | 0 % | 54 ms | 82 ms | 99 ms | ✅ |
| 2 000 | par 100 | 10,6 s | 0 | 0 % | 79 ms | 125 ms | 140 ms | ✅ |
| 5 000 | par 100 | 40,6 s | 0 | 0 % | 178 ms | 295 ms | 344 ms | ✅ |
| 500 | tous ensemble | 2,9 s | 0 | 0 % | 40 ms | 62 ms | 74 ms | ✅ |
| 1 000 | tous ensemble | 5,9 s | 0 | 0 % | 57 ms | 91 ms | 117 ms | ✅ |
| 2 000 | tous ensemble | 11,9 s | 0 | 0 % | 101 ms | 414 ms | 473 ms | ✅ |
| 3 000 | tous ensemble | 18,9 s | 2 776 | 92,5 % | — | — | — | ❌ |

À 3 000 arrivées simultanées, 2 776 spectateurs n'ont pas reçu la réponse du serveur dans
les 10 secondes que l'app attend (`ACK_TIMEOUT_MS`).

**Limite :** 5 000 spectateurs dans une même salle quand ils arrivent par groupes de 100
(pas testé au-delà), 2 000 s'ils ouvrent tous la salle à la même seconde.

## Résultats : le chargement des pages

2 000 requêtes par case, toutes réussies (0 échec, aucune réponse autre que 2xx). Chaque
case donne le p95 et le débit. `-c` est le nombre de requêtes en cours au même moment, pas
un nombre d'utilisateurs (voir la section suivante).

| Page (requête) | `-c 10` | `-c 50` | `-c 100` | `-c 200` |
|---|---|---|---|---|
| Discover (`GET /parties?page=1&limit=20&visibility=PUBLIC`) | 61 ms, 215 req/s | 383 ms, 144 req/s | 790 ms, 138 req/s | 1 548 ms ❌, 136 req/s |
| Une salle (`GET /parties/:id/votes/mine?page=1&limit=100`) | 50 ms, 252 req/s | 210 ms, 277 req/s | 435 ms, 261 req/s | 848 ms, 259 req/s |
| Onglet Playlists (`GET /playlists?page=1&limit=20&visibility=PUBLIC`) | 76 ms, 166 req/s | 312 ms, 181 req/s | 633 ms, 178 req/s | 1 314 ms ❌, 166 req/s |
| Une playlist (`GET /playlists/:id`) | 43 ms, 284 req/s | 191 ms, 287 req/s | 412 ms, 280 req/s | 1 065 ms ❌, 263 req/s |

**Limite :** 100 requêtes en cours au même moment pour les 4 pages (200 pour une salle).
À pleine vitesse, le serveur répond à environ 140 requêtes par seconde pour la page la
plus lourde (Discover) et 250 à 290 pour une salle ou une playlist. Plus de requêtes à la
fois ne donne pas plus de débit : elles attendent leur tour, seul le délai monte.

## Combien d'utilisateurs en même temps

Hypothèse : un utilisateur actif ouvre une page environ toutes les 10 secondes, soit
0,1 requête par seconde.

- Avec la page la plus lourde (Discover, environ 140 requêtes par seconde) :
  140 × 10 = **environ 1 400 utilisateurs actifs en même temps**. C'est une estimation
  prudente : les autres pages sont jusqu'à 2 fois plus rapides.
- En direct, une même salle tient 5 000 spectateurs (file de 1 morceau ; voir les limites
  pour une file pleine).

**Sur ce PC : environ 1 400 utilisateurs actifs à la fois, et jusqu'à 5 000 qui suivent
une même salle en direct.** Le sujet attend des milliers d'utilisateurs pour un petit
serveur : ce PC est du même ordre.

## Limites connues

- **File pleine.** Les mesures du direct utilisent une salle avec 1 morceau. Une file
  pleine (100 morceaux, `MAX_PARTY_SONGS`) rend chaque mise à jour environ 100 fois plus
  lourde, et le serveur la prépare pour chaque spectateur. Mesuré une fois avec une copie
  du script qui remplit la file : 500 spectateurs donnent un p95 de 627 ms (bon),
  1 000 spectateurs 1 745 ms (pas bon). Une salle pleine tient donc entre 500 et
  1 000 spectateurs sur ce PC.
- **Arrivées simultanées.** Chaque nouvelle connexion vérifie le compte et les droits :
  le serveur en accepte environ 120 à 190 par seconde (5 000 en 40,6 s, 2 000 en 11,9 s).
  Au-delà de 2 000 personnes à la même seconde, certaines attendent plus de 10 secondes et
  l'app abandonne. Par groupes de 100, 5 000 passent.
- **Même PC.** Les outils de test et le serveur se partagent le processeur.
- **Pas testé au-delà de 5 000 spectateurs** : le script ouvre toutes les connexions depuis
  un seul processus, sur ce même PC.

## Refaire les mesures

Depuis `music-room-api`, avec les conteneurs lancés :

```
docker compose exec backend npx ts-node scripts/ramp-up.ts 500          # 500 spectateurs, par 100
docker compose exec backend npx ts-node scripts/ramp-up.ts 2000 2000    # 2 000, tous ensemble
```

Pour `ab`, la limite de requêtes doit être relevée, sinon tout ce qui dépasse 60 requêtes
par minute sur une route reçoit 429 :

1. Dans `.env` : `THROTTLE_LIMIT=1000000`, puis `docker compose up -d backend` (un
   `restart` ne relit pas `.env`).
2. `docker compose exec backend npx ts-node scripts/ramp-up.ts http`, puis coller une des
   4 commandes affichées dans un autre terminal, en changeant `-c`. Le jeton affiché
   marche 15 minutes.
3. Ctrl+C dans le premier terminal : les données de test sont supprimées.
4. Remettre `THROTTLE_LIMIT=60`, puis `docker compose up -d backend`.

Sur une machine plus modeste (un PC de l'école par exemple), commencer petit :
`ramp-up.ts 100` et `ab -c 10`.
