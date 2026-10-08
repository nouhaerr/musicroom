# Sécurité — auth, utilisateurs et social

Cette note décrit les protections présentes et leurs limites ; elle ne constitue
pas un audit de sécurité complet du produit.

| Risque | Protection implémentée | Preuve automatisée |
|---|---|---|
| Tentatives répétées de connexion | 10 requêtes de login par minute et par IP ; mot de passe hashé avec bcrypt, coût 12 | Intégration : la onzième tentative reçoit 429 avec le vrai guard |
| Rejeu d’un refresh token | Hash SHA-256 en base, rotation transactionnelle, révocation de toutes les sessions en cas de rejeu | Tests de sessions et intégration concurrente |
| Session utilisée après logout/reset | Vérification de la session en base à chaque accès protégé ; révocation au logout/reset | Intégration : ancien access token et refresh refusés |
| Réutilisation du lien de reset | Hash en base, expiration, consommation unique et révocation des autres liens | Intégration avec deux resets simultanés |
| Substitution d’identité sociale | Google : signature, émetteur, audience, expiration et email vérifié ; Facebook : `debug_token`, application, utilisateur et profil concordants | Tests des fournisseurs avec réponses invalides |
| Fusion abusive par email | 409 si l’email existe ; liaison exigeant un JWT Sonora et un token social valide | Intégration pour Google et Facebook |
| Fuite de profil ou de ressource privée | Sélection explicite des champs, contrôle d’amitié, visibilité et invitations actives | Intégration profils, recherche et invitations |
| Utilisation de l’appareil d’autrui | Association d’un appareil aux logs uniquement pour son propriétaire ; suppression filtrée par propriétaire | Intégration appareils |
| Fuite de tokens dans les erreurs sociales | Messages génériques pour les pannes ; aucune remontée du corps brut Meta ou des erreurs réseau du fournisseur | Tests des erreurs réseau, JSON et HTTP |

Les routes de renvoi de vérification et de mot de passe oublié renvoient le même
message même en cas de compte absent ou d’échec SMTP. Cela ne constitue pas une
garantie d’indistinguabilité temporelle ; l’inscription renvoie explicitement 409
si l’email est déjà utilisé.

## Limites à traiter lors du déploiement

- Les vérifications de forme d’un secret ne prouvent pas son entropie. Utiliser
  le générateur fourni ou un générateur cryptographique, et conserver les secrets
  dans un gestionnaire adapté au déploiement.
- Le limiteur actuel utilise la mémoire d’une instance et son interprétation de
  l’adresse IP. Le déploiement derrière un proxy ou sur plusieurs instances exige
  une configuration et des tests spécifiques ; ne pas faire confiance arbitrairement
  aux headers d’adresse fournis par le client.
- Un access token volé reste utilisable tant que sa session n’est pas révoquée ou
  expirée. La protection contre le rejeu de refresh ne prévient pas tout vol de session.
- HTTPS et le stockage sécurisé des tokens sur Android/iOS dépendent encore du
  déploiement et du frontend. Les tests backend ne les valident pas.
- Le mode mail `log` imprime les liens en développement et est interdit avec
  `NODE_ENV=production`. Utiliser SMTP pour l’envoi réel.
- La conservation des sessions consommées, des logs et des sauvegardes, ainsi que
  la suppression des données, nécessitent une politique et une procédure opérationnelle.
- Les échecs survenant dans les guards, avant l’intercepteur, ne sont pas tous
  enregistrés par `ActionLogInterceptor`. Les journaux d’action ne remplacent pas
  une supervision des échecs de connexion et du limiteur.

Les tests de charge et les protections propres aux modules musique sont hors du
périmètre de cette note.

## Configuration des secrets JWT

La configuration est validée par `ConfigModule` avant l’instanciation des services.
Les deux secrets sont obligatoires dans tous les environnements et doivent être
différents, sans espaces, longs d’au moins 32 octets. Les marqueurs `change_me`,
`replace_me`, les anciens secrets `dev_*_secret` et les valeurs faites d’un seul
caractère répété sont refusés. Les erreurs ne contiennent jamais les valeurs.
Les services utilisent `getOrThrow` : aucune valeur de secours ne signe de token.

Sur un premier `make`, si `.env` n’existe pas, le générateur crée le fichier à partir
du modèle et génère deux valeurs indépendantes avec `crypto.randomBytes(32)`.
Le fichier existant n’est jamais réécrit automatiquement au démarrage.

Pour une rotation volontaire dans le dossier `music-room-api` :

```sh
make secrets
docker compose up -d --no-deps --force-recreate backend
```

Alternative avec Node installé sur l’hôte : `npm run security:generate-secrets`.
Seuls `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET` sont remplacés, sans affichage
des valeurs. Les paramètres SMTP/OAuth et les comptes en base sont conservés.
La rotation invalide les anciens access tokens, refresh tokens et liens de
vérification/réinitialisation. Se reconnecter ou demander un nouveau lien.
Sur plusieurs instances, coordonner la mise à jour des deux secrets.

## Dépendances

Après mise à jour le 6 octobre 2026, `npm run security:audit` (`npm audit --omit=dev`)
ne signale aucune vulnérabilité connue, contre 16 entrées auparavant, dont 2 critiques.
Ce résultat dépend du registre npm à la date de l’audit ; ce n’est pas une garantie
d’absence de failles dans le produit.

Le projet utilise désormais NestJS 11.2.7 / Express 5, bcrypt 6 et Jest 30.
Node 22 et Prisma 5.22 sont conservés. Les types `expiresIn` suivent ceux de
`@nestjs/jwt`. Un override limité à `@nestjs/swagger` remplace son `js-yaml` fixé
à 5.3.0 par une version corrigée compatible 5.4.3 ou ultérieure dans la même majeure.
Les correctifs de `brace-expansion` 1.1.21 et `fast-uri` 3.1.8 sont verrouillés
dans le lockfile. Aucun `npm audit fix --force` n’a été utilisé.

L’audit complet, avec les outils de développement, signale encore **20 entrées
modérées**, sans entrée élevée ou critique, contre 65 entrées avant cette mise à
jour. Elles proviennent du même avis sur `sprintf-js`, via `argparse` 1,
`js-yaml` 3 et les outils de couverture Jest/ts-jest. Le registre ne propose pas
de version corrigée de `sprintf-js` lors de cette vérification. Ce comptage inclut
les paquets indirectement impactés ; il ne correspond pas à 20 failles distinctes.
Suivre [l’avis GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
et mettre à jour cette chaîne quand un correctif compatible sera disponible.
L’image Docker de développement installe ces outils ; le résultat de l’audit
`--omit=dev` ne signifie donc pas que cette image entière est sans alerte.

La CI vérifie l’audit de production. Utiliser `npm audit` pour surveiller aussi
les outils de développement.
