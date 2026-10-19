# Choix techniques — authentification, utilisateurs et social

État au 8 octobre 2026. Cette justification couvre les composants de cette partie,
pas une validation de tous les services du projet.

| Choix | Pourquoi il convient au projet | Compromis et limites |
|---|---|---|
| NestJS + TypeScript | Modules auth, users, friends, invitations et devices séparés ; injection pour remplacer SMTP/OAuth dans les tests ; guards partagés pour les routes protégées. | Décorateurs et injection demandent un apprentissage. Le typage ne valide pas une réponse distante à l’exécution. |
| PostgreSQL | Relations, clés étrangères et contraintes uniques pour les comptes, invitations et votes ; transactions pour les mutations concurrentes. | Les contraintes ne remplacent pas les permissions applicatives. Il faut choisir un ordre de verrouillage cohérent et tester les courses. |
| Prisma | Client typé et migrations versionnées ; même schéma pour le développement et les tests jetables. | Un ORM ne rend pas automatiquement toutes les opérations atomiques. Le projet utilise aussi des verrous SQL explicites et traite les collisions de contraintes. |
| REST + JSON | Contrat accessible avec Swagger, fetch et les clients mobiles ; chaque mutation a une route et des statuts HTTP identifiables. | Les types de réponse et exemples Swagger restent à compléter. Les flux temps réel nécessitent une couche complémentaire. |
| JWT + sessions persistées | Access tokens signés, avec vérification de la session en base pour rendre logout/reset effectifs sans attendre leur expiration. | Lecture en base sur les accès protégés. Le client doit sérialiser les renouvellements ; un token consommé rejoué révoque toutes les sessions. |
| bcrypt pour les mots de passe | Hash coûteux, avec sel géré par la bibliothèque ; coût 12 dans cette application. | Coût CPU à mesurer sous charge. Le hash ne protège pas contre toutes les tentatives en ligne : le limiteur est aussi nécessaire. |
| SHA-256 pour les tokens de refresh/reset | Comparaison avec un hash en base sans stocker les tokens utilisables en clair. Ces tokens ne sont pas des mots de passe choisis par l’utilisateur. | La sécurité dépend aussi des secrets de signature aléatoires et du stockage du token côté client. |
| SMTP via Nodemailer | Un service d’envoi isolé, testable, configurable par environnement ; emails réels de validation et reset. | Les pannes SMTP existent. Le renvoi/reset conserve une réponse générique ; la délivrabilité dépend du fournisseur et de sa configuration. |
| OAuth social validé côté serveur | Le backend vérifie les tokens Google/Facebook puis émet ses propres sessions. Une adresse email commune ne suffit pas à fusionner deux comptes. | Les configurations des fournisseurs, permissions et SDK natifs doivent être testées séparément. |
| Docker + Make | Versions de Node/PostgreSQL communes et migrations au démarrage ; commandes partagées entre développeurs. | Le conteneur actuel est destiné au développement. Les montages, permissions Linux et secrets de production nécessitent un traitement adapté. |
| React Native + Expo | Base TypeScript Android/iOS et outils de développement communs. Le client réutilise le contrat HTTP sans accès direct à PostgreSQL. | Google/Facebook natifs nécessitent une development build et des identifiants de plateforme ; un export JS ne prouve pas le fonctionnement sur téléphone. |
| Expo SecureStore | Stockage du refresh token via les mécanismes de stockage sécurisé de la plateforme ; access token conservé en mémoire. | Ne remplace pas HTTPS ni la révocation serveur. Une réponse de refresh perdue exige ici une reconnexion pour éviter un rejeu. |
| Jest, tests PostgreSQL et GitHub Actions | Vérifier séparément les services puis les routes/transactions réelles ; exécuter les contrôles sur les PR. | Les fournisseurs sont simulés dans les suites. Les tests réels, tests de charge et vérifications Android/iOS restent complémentaires. |

## Alternatives considérées dans cette justification

Express seul aurait demandé moins de conventions initiales mais davantage
d’assemblage pour les modules et l’injection utilisés ici. Du SQL entièrement
manuel donnerait un contrôle direct au prix de plus de code de mapping et de
migrations. Des JWT sans session en base simplifieraient certaines lectures,
mais ne permettraient pas la révocation immédiate retenue pour ce projet.
Ces comparaisons expliquent les compromis ; elles ne sont pas des benchmarks.

## Preuves et travail partagé

La [CI backend du commit c74e20b](https://github.com/nouhaerr/musicroom/actions/runs/37807903307)
a réussi. Le [bilan](AUTH-USERS-STATUS.md) distingue les tests automatisés et ceux
confirmés manuellement. Le [guide mobile](../../music-room-mobile/README.md) décrit
les écrans disponibles et la recette restante.

La justification de Socket.io/Redis et les chiffres de capacité doivent être
complétés avec l’auteur de la partie temps réel, sur son implémentation et ses
mesures. Aucun nombre maximal d’utilisateurs n’est déduit des tests fonctionnels.
