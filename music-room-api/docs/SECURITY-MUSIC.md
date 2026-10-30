# Sécurité — salles, playlists, temps réel et catalogue

Suite de la [note de sécurité auth et social](SECURITY-AUTH.md), pour les modules
musique (sujet V.6 : protéger les utilisateurs, identifier les autres risques et
expliquer les protections possibles). Comme elle, ce n'est pas un audit complet.

## Risques et protections

| Risque | Protection implémentée | Preuve automatisée |
|---|---|---|
| Voter plusieurs fois pour le même morceau | Un vote par personne et par morceau, garanti par une contrainte unique en base (`Vote`, `partySongId` + `userId`) ; le deuxième reçoit 409 | Pas de test dédié : la contrainte de la base |
| Voter sans en avoir le droit | La règle de la salle est vérifiée par le serveur à chaque vote : tout le monde, les invités seulement, ou les personnes sur place pendant les horaires (distance calculée par le serveur) | `parties-room-data.e2e-spec.ts` |
| Proposer deux fois le même morceau, remplir la file sans fin | Un morceau une seule fois par salle (409) ; file et playlist limitées à `MAX_PARTY_SONGS` / `MAX_PLAYLIST_SONGS` (100 par défaut, 409 au-delà) | `list-limit.e2e-spec.ts` |
| Passer au morceau suivant à la place de l'hôte, ou deux fois en même temps | Seul le propriétaire peut le faire (403) ; verrou optimiste `playbackVersion` : une demande basée sur un état ancien reçoit 409 | `parties-playback.e2e-spec.ts` (les tests du verrou échouent sans lui) |
| Modifier une playlist sans en avoir le droit | `editLicense` vérifié à chaque ajout, déplacement ou suppression (403) ; réglages d'accès réservés au propriétaire | `playlists-editing.e2e-spec.ts` |
| Deux personnes déplacent le même morceau en même temps | Le client renvoie la position qu'il a vue (`expectedPosition`) ; si elle a changé, 409 et l'app relit | `playlists-editing.e2e-spec.ts` |
| Voir une salle ou une playlist privée | Visible seulement par le propriétaire et les invités (invitation en attente ou acceptée) ; la même règle s'applique aux listes, aux routes et au temps réel | `playlists-data.e2e-spec.ts`, `realtime.e2e-spec.ts` |
| Continuer à regarder en direct après avoir perdu l'accès | Les droits sont revérifiés à chaque mise à jour envoyée : une invitation retirée ou refusée coupe l'abonnement (`unsubscribed`, `FORBIDDEN`) avant le prochain envoi | `realtime.e2e-spec.ts` |
| Garder la connexion en direct après une déconnexion | La session est revérifiée à chaque message, avec les mêmes règles qu'à la connexion | `realtime.e2e-spec.ts` |
| Saturer la connexion en direct | 5 connexions par compte, 20 abonnements par connexion, 30 messages par 10 secondes, 16 Ko par message ; au plus 5 mises à jour par seconde par salle (les changements entre deux sont regroupés) | `realtime.e2e-spec.ts` |
| Saturer les routes HTTP | `THROTTLE_LIMIT` requêtes par minute, par route et par IP (60 par défaut, 429 au-delà) | `list-limit.e2e-spec.ts` |
| Réponse invalide ou piégée du catalogue (Deezer) | Identifiants vérifiés (chiffres seulement) ; chaque réponse est contrôlée (champs, types, longueurs) ; 5 s au plus, sinon 502 sans planter ; les URL d'extrait, qui expirent, ne sont jamais stockées | `deezer.provider.spec.ts` |
| Même morceau importé deux fois en même temps | Identifiant du catalogue unique en base ; le second import reprend la ligne du premier | `songs.e2e-spec.ts` (course forcée) |

## Limites connues

- **Fausse position.** La règle « sur place pendant les horaires » utilise la position
  envoyée par le téléphone. Le serveur ne peut pas la prouver : quelqu'un peut envoyer
  de fausses coordonnées avec `curl`. Le contrôle évite les erreurs honnêtes, pas la
  triche. Une vraie preuve demanderait un élément du lieu (un code affiché sur place,
  un QR code qui change).
- **Plusieurs comptes.** Un vote par compte, mais une personne peut créer plusieurs
  comptes, chacun avec sa propre adresse email. La règle « invités seulement » limite
  ce risque.
- **Limiteur par IP.** Plusieurs téléphones derrière la même IP (le wifi de l'école)
  partagent la même limite par minute. Voir aussi les limites de déploiement de la
  [note auth](SECURITY-AUTH.md#limites-à-traiter-lors-du-déploiement).
- **Salle très suivie.** Une salle à la file pleine tient entre 500 et 1 000 spectateurs
  sur notre PC : voir [RAMP-UP.md](RAMP-UP.md).
