# Vérifications locales et GitHub Actions

## CI et lint : à quoi servent-ils ?

Le **lint** analyse le code sans démarrer l’application. Il repère certaines erreurs
comme une variable inutilisée ou une construction suspecte. Ici, il est exécuté
avec ESLint et typescript-eslint via `npm run lint` (ou `make lint` dans Docker).
Il complète les tests : il ne prouve pas que la connexion ou les invitations fonctionnent.

La **CI**, pour *intégration continue*, lance automatiquement les vérifications sur
GitHub après un push ou lors d’une pull request. Elle évite de dépendre uniquement
des tests faits sur l’ordinateur d’un développeur. Par exemple, si une modification
casse la connexion, un test peut faire échouer le job et afficher une croix rouge
dans la pull request. Une règle de branche est nécessaire pour rendre cette réussite
obligatoire avant fusion.

## Fonctionnement du workflow

Le workflow `.github/workflows/backend-ci.yml` est lancé sur les push vers `main`,
sur `pull_request` et manuellement depuis Actions. Un push sur une branche de PR
ne lance donc plus deux exécutions. Il utilise Node 22.23.3 et PostgreSQL 16.15,
comme le développement Docker. Les actions GitHub sont fixées par commit.

Étapes :

1. `npm ci` : installation depuis le lockfile.
2. `npm run security:audit` : avis npm sur les dépendances de production.
3. `npm run prisma:generate`.
4. `npm run lint` : ESLint et typescript-eslint, sans réécriture des fichiers.
5. `npm run typecheck`.
6. `npm test -- --runInBand`.
7. `npm run build`.
8. `npm run test:e2e` : schémas aléatoires et vraies migrations PostgreSQL.

L’audit interroge le registre npm : une nouvelle vulnérabilité publiée peut faire
échouer la CI même sans changement de code. Le résultat dépend aussi de la
disponibilité du registre. L’audit complet incluant les outils de développement
reste consultable avec `npm audit` ; ses limites sont détaillées dans
[SECURITY-AUTH.md](SECURITY-AUTH.md).

Les identifiants PostgreSQL du workflow appartiennent uniquement à son service
éphémère. Aucun secret de développement/production ni de fournisseur OAuth/SMTP
n’est requis. Les tests génèrent leurs propres secrets JWT. Le token GitHub a
uniquement le droit de lire le dépôt ; aucune étape ne publie ou ne déploie l’API.

La configuration ESLint couvre `src`, `test`, les scripts Node et les fichiers de
configuration JavaScript. Les fichiers Prisma générés, `dist`, la couverture et
les dépendances sont exclus. Pour demander explicitement les corrections
automatiques : `npm run lint:fix`.

Après une modification du lockfile, `make` reconstruit l’image et renouvelle les
volumes anonymes des dépendances. Pour vérifier dans le conteneur :

```sh
make lint
make typecheck
make test
docker compose exec backend npm run build
docker compose exec backend sh -c 'TEST_DATABASE_URL="$DATABASE_URL" npm run test:e2e'
```

Les commandes peuvent aussi être lancées sur l’hôte avec Node et `npm ci`, à condition
de générer le client Prisma et de fournir une `TEST_DATABASE_URL` accessible depuis
l’hôte. Les tests d’intégration exigent un rôle pouvant créer des schémas et ne
réinitialisent jamais le schéma `public`.

Le workflow doit être poussé avant de pouvoir constater un résultat dans GitHub
Actions. Une règle GitHub de protection de branche peut ensuite rendre le job
`Backend CI / backend` obligatoire avant fusion ; elle n’est pas configurée par
le fichier YAML.

Configuration fondée sur les documentations officielles :
[typescript-eslint](https://typescript-eslint.io/getting-started/),
[checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node).
