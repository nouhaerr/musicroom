# État de la partie auth, utilisateurs et social

Point du 7 octobre 2026, limité à la branche locale et aux tests décrits ci-dessous.
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
Le workflow GitHub Actions audit/lint/types/tests/build/intégration est préparé ; son
exécution sur GitHub reste à constater après push. Voir [CI.md](CI.md).
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

- Frontend Expo : configuration du projet, SDK sociaux Android/iOS, écrans de
  vérification/réinitialisation, stockage des sessions et renouvellements sérialisés.
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
- Livrables partagés : tests de charge, justification technique et déclaration
  d’usage de l’IA à coordonner avec l’autre développeur.
- GitHub : pousser le workflow, vérifier le premier résultat de CI, puis configurer
  si souhaité le contrôle obligatoire avant fusion dans les règles du dépôt.

Les fonctionnalités musique A8–A11 et leurs revues restent dans le périmètre de
l’autre développeur. Ce document ne confirme pas leur état sur les branches distantes.
