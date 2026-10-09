# Utilisation de l’IA — contribution auth, utilisateurs, social et base mobile

Note préparée le 8 octobre 2026 à partir du travail réalisé avec Codex. Elle porte
sur cette contribution ; l’autre développeur doit documenter son propre usage.
La formulation finale doit être relue par les auteurs et confrontée au sujet remis
à l’évaluation. Ce document ne vaut pas attestation de revue humaine exhaustive.

## Assistance utilisée

Codex a servi à expliquer NestJS, Prisma, les sessions, SMTP/OAuth, Git/PR et la CI ;
à proposer, écrire et adapter du code, des tests et de la documentation ; à exécuter
les vérifications locales ; et à préparer les commits, PR et commentaires demandés.

Les domaines concernés comprennent la sécurité des fournisseurs Google/Facebook,
l’envoi SMTP, les secrets JWT, les tests auth/social, les mises à jour de dépendances,
la CI et la première base Expo (écrans email et client de sessions). L’assistance
a aussi servi à relire A8/A9 et à reproduire des problèmes de concurrence dans des
checkouts et une base de données de test séparés.

## Vérification des propositions

- Inspection du code et des différences avant intégration ; erreurs rencontrées
  corrigées à partir des diagnostics de compilation et des tests.
- Tests unitaires et tests HTTP/PostgreSQL couvrant les permissions, migrations,
  collisions, rotation/rejeu et révocation des sessions.
- Recette Swagger confirmée par l’utilisatrice pour les parcours décrits dans
  [AUTH-USERS-STATUS.md](AUTH-USERS-STATUS.md), dont les emails réels et les connexions
  sociales. Ces confirmations ne sont pas étendues aux écrans mobiles non testés.
- CI backend réussie sur GitHub pour le commit `c74e20b` ; résultats locaux du
  nouveau mobile consignés séparément de la validation sur appareils.

## Limites et responsabilité des auteurs

Une proposition ou un résultat positif produit avec l’aide de l’IA peut être
incomplet. Les tests simulés ne prouvent ni la disponibilité d’un fournisseur,
ni la conformité d’un déploiement, ni la performance sous charge. Un audit de
dépendances sans alerte n’est pas un audit complet du produit.

Avant livraison, les auteurs doivent pouvoir expliquer les décisions, relire le
code qu’ils soumettent, exécuter les recettes restantes et compléter les documents
avec les données réelles du déploiement. Les pages légales sont encore des brouillons.
Les résultats mobiles Android/iOS, l’intégration des SDK sociaux et les mesures de
charge ne sont pas déclarés réussis tant qu’ils n’ont pas été exécutés.

Les secrets de configuration restent dans les fichiers locaux exclus de Git.
Les exemples documentés doivent rester fictifs et les journaux/tests ne doivent
pas publier de tokens réels. Cette note ne doit pas reproduire des valeurs privées.
