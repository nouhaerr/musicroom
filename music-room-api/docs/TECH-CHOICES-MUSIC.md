# Choix techniques — salles, playlists, temps réel et catalogue

Suite des [choix techniques auth et social](TECH-CHOICES.md), pour les modules musique.
NestJS, PostgreSQL, Prisma, REST + JSON, Docker et Expo y sont déjà justifiés ; cette
note couvre ce qui est propre aux salles, aux playlists et au direct.

| Choix | Pourquoi il convient au projet | Compromis et limites |
|---|---|---|
| Deezer comme catalogue | API publique de recherche, sans compte ni clé ; un vrai catalogue avec des extraits de 30 secondes et des liens permanents. Le reste du code ne dépend que d'un contrat `MusicProvider` : changer de catalogue ne touche ni les salles ni les playlists. | Seulement des extraits de 30 s (les morceaux entiers demandent un compte et le SDK Deezer). Si Deezer est en panne, la recherche répond 502. Les URL d'extrait expirent : l'app en redemande une avant chaque lecture. |
| Le serveur importe les morceaux | L'app n'envoie que l'identifiant Deezer (`externalId`) ; le serveur lit le morceau chez Deezer, le vérifie et l'enregistre. Personne ne peut inventer un titre ou une URL. | Un appel à Deezer à chaque morceau nouveau pour la base. |
| Socket.IO pour le direct | WebSocket avec reconnexion automatique, et une réponse (`ok` ou erreur) à chaque abonnement ; la même bibliothèque côté serveur et côté app. | Un seul processus serveur : plusieurs instances demanderaient un adaptateur partagé (Redis). Absent de Swagger : les messages sont décrits dans le README. |
| Des instantanés complets, pas des différences | Chaque mise à jour contient tout l'état de la salle ou de la playlist. Un message perdu ou en retard est corrigé par le suivant, et l'app remplace simplement son état. Un seul envoyeur par salle garde l'ordre ; les changements de 200 ms sont regroupés (5 envois par seconde au plus). | Plus lourd quand la liste est longue : une salle à la file pleine tient entre 500 et 1 000 spectateurs sur notre PC (voir [RAMP-UP.md](RAMP-UP.md)). |
| Toute modification passe par REST | Une seule porte pour les règles, la validation et les logs ; la connexion en direct ne fait que s'abonner et recevoir. | Une modification fait deux trajets : la requête, puis la mise à jour poussée à tous. |
| Verrous et numéros de version | Passer au morceau suivant envoie `expectedPlaybackVersion`, déplacer un morceau envoie `expectedPosition` ; les changements d'accès verrouillent la ligne en base (`FOR UPDATE`). Deux actions au même moment ne s'écrasent jamais : la seconde reçoit 409. | L'app doit gérer le 409 : relire, puis réessayer si l'utilisateur le veut. |
| Les limites dans `.env` | `MAX_PARTY_SONGS`, `MAX_PLAYLIST_SONGS` et `THROTTLE_LIMIT`, vérifiées au démarrage (un nombre entier dans un intervalle). On les change sans toucher au code, par exemple pour les tests de charge. | Baisser une limite cache les morceaux en trop sans les supprimer (choix voulu, voir « Limites connues » du README). |
| La règle de vote vérifiée par le serveur | Invités seulement, ou sur place pendant les horaires : le serveur calcule la distance et l'heure à chaque vote. Le backend reste la référence. | La position vient du téléphone : elle peut être falsifiée (voir [SECURITY-MUSIC.md](SECURITY-MUSIC.md)). |
| Côté app : une seule connexion en direct | Toutes les pages ouvertes partagent une connexion ; après une reconnexion, l'app se réabonne à tout ce qu'elle regarde et reçoit un instantané frais. | Sans réseau, pas de direct : le mode hors ligne (bonus) n'est pas fait. |
| Notre script + `ab` pour la charge | Le script mesure ce que vit l'utilisateur (le temps entre un vote et l'écran) ; `ab` est l'outil cité par le sujet pour les pages. Les deux nettoient leurs données. | Ils tournent sur le même PC que le serveur : les chiffres sont un minimum. |

## Alternatives considérées

- **Spotify ou YouTube** comme catalogue : il faut une clé d'application et, pour
  Spotify, un compte de l'utilisateur pour écouter. Deezer suffit pour rechercher et
  écouter des extraits sans configuration.
- **Envoyer des différences** (« le morceau X a +1 vote ») : des messages plus petits,
  mais un message perdu laisse l'app fausse jusqu'au rechargement, et l'ordre des
  messages devient critique. Les instantanés complets évitent ces deux problèmes.
- **Relire toutes les secondes (polling)** au lieu du direct : plus simple, mais des
  milliers de requêtes inutiles et une seconde de retard. Le direct n'envoie que quand
  quelque chose change.
