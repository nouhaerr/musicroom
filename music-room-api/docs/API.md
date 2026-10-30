# L'API : REST, JSON et sa documentation (V.4)

## Où est la documentation

- **Swagger** : `http://localhost:3000/docs`, générée depuis le code. Pour chacune des
  62 routes : la méthode et le chemin, une phrase qui dit ce qu'elle fait, les entrées
  (corps, paramètres de chemin et de requête, avec leurs règles) et la sortie (chaque
  champ de la réponse, avec son type).
- **Le même contrat en JSON** (OpenAPI 3.0) : `http://localhost:3000/docs-json`, à
  importer dans Postman ou dans un générateur de client.
- **La doc est vérifiée** : chaque route déclare comme type de retour la classe que
  Swagger affiche. Si un champ documenté manquait dans la vraie réponse, la vérification
  des types (`npm run typecheck`, lancée par la CI) échouerait.
- **Le temps réel** (WebSocket) n'est pas dans Swagger : il est décrit dans la section
  « Temps réel (WebSocket) » du [README](../README.md).

## Pourquoi REST

L'API suit les principes REST :

- **Des ressources, une adresse chacune** : `/parties`, `/parties/:id`,
  `/parties/:id/queue`, `/playlists/:id/songs`…
- **Les méthodes HTTP disent l'action** : `GET` lit sans rien changer, `POST` crée ou
  lance une action (voter, passer au morceau suivant, inviter), `PATCH` modifie une
  partie, `PUT` remplace (la photo de profil), `DELETE` supprime. Une exception : le lien
  de vérification envoyé par email confirme l'adresse en `GET`, car un lien ouvert depuis
  un email ne peut faire qu'un `GET`.
- **Les codes HTTP disent le résultat** : 201 créé, 400 entrée invalide, 401 pas
  connecté, 403 pas le droit, 404 introuvable, 409 refusé par l'état actuel, 429 trop de
  requêtes.
- **Sans état côté serveur** : chaque requête porte son jeton
  (`Authorization: Bearer <accessToken>`). N'importe quelle instance du serveur peut
  répondre, sans mémoire de la requête précédente.
- **Les listes sont paginées** : `?page=1&limit=20`, 100 au plus par page.
- **Les écritures concurrentes sont protégées** : un client renvoie ce qu'il a vu
  (`expectedPlaybackVersion` pour passer au morceau suivant, `expectedPosition` pour
  déplacer un morceau). Si quelqu'un a changé l'état entre-temps, la réponse est 409 et
  l'app relit.

Pourquoi ce choix :

- C'est le standard le plus répandu : l'app l'appelle avec un simple `fetch`, et on la
  teste avec `curl`, Swagger ou `ab` (voir [RAMP-UP.md](RAMP-UP.md)).
- NestJS le gère nativement, et Swagger se génère depuis les mêmes classes que la
  validation des entrées.
- Nos écrans demandent des données fixes : un écran correspond à une ou deux routes.

Ce qu'on n'a pas choisi :

- **GraphQL** : le client choisit les champs qu'il veut, sur un seul point d'entrée.
  C'est utile quand les écrans varient beaucoup, mais il faut un schéma et des
  résolveurs en plus, et le cache HTTP et les codes d'erreur ne s'appliquent plus.
  Nos écrans sont fixes : le gain serait faible.
- **gRPC** : binaire et rapide, mais il demande HTTP/2 et des clients générés, mal pris
  en charge par React Native / Expo, et illisible pour tester à la main.

## Le temps réel à côté de REST

REST ne sait pas prévenir un client : c'est toujours le client qui demande. Pour les
salles et les playlists, une connexion WebSocket (Socket.IO) pousse l'état à jour à tous
ceux qui regardent. La règle reste simple : **toute modification passe par REST**
(voter, ajouter, déplacer…) ; la connexion ne fait que s'abonner et recevoir l'état.
Le serveur reste la seule référence.

## Pourquoi JSON

- **Natif des deux côtés** : le serveur et l'app sont en TypeScript ; `fetch` et
  `JSON.parse` le lisent sans bibliothèque.
- **Lisible** : on lit une réponse dans un terminal, dans Swagger ou dans un journal.
- **Universel** : tous les langages et tous les outils de test le comprennent.
- **Ses types** : texte, nombre, booléen, `null`, liste, objet. Les dates voyagent en
  texte ISO 8601 (`"2026-10-30T12:00:00.000Z"`).
- Toutes les entrées et toutes les sorties sont en JSON, erreurs comprises
  (`{ "statusCode": 404, "message": "Party not found", "error": "Not Found" }`). Seules
  exceptions : les 2 liens envoyés par email, qui répondent une page HTML.

Son coût : du texte, plus gros qu'un format binaire. Une mise à jour d'une salle dont la
file est pleine (100 morceaux) pèse plusieurs dizaines de Ko, et le serveur la prépare
pour chaque spectateur : c'est la limite décrite dans [RAMP-UP.md](RAMP-UP.md).

Ce qu'on n'a pas choisi :

- **XML** : plus verbeux, et pas natif en JavaScript.
- **Protobuf ou MessagePack** : binaires et plus compacts, mais il faut un schéma ou une
  bibliothèque de plus des deux côtés, et on ne peut plus lire les échanges à l'œil.
  À notre échelle, JSON suffit.
