# Envoyer des emails avec Gmail SMTP

Le backend envoie les emails de vérification et de réinitialisation via Nodemailer.
Le mode `MAIL_TRANSPORT=log` affiche les liens en développement ; `smtp` envoie
réellement les messages, sans écrire les tokens dans les logs.

## 1. Préparer Gmail

1. Activer la validation en deux étapes du compte Google expéditeur.
2. Ouvrir [Mots de passe d'application](https://myaccount.google.com/apppasswords).
3. Créer un mot de passe nommé **Music Room**.
4. Copier ce mot de passe dans `.env`, sans les espaces de présentation.

Utiliser le mot de passe d'application, pas le mot de passe habituel Google.
Si l'option est absente, vérifier les restrictions du compte professionnel/scolaire,
la Protection Avancée ou une validation en deux étapes limitée aux clés de sécurité.
[Aide officielle Google](https://support.google.com/accounts/answer/185833?hl=fr).

## 2. Configurer `.env`

Modifier seulement le bloc mail de `music-room-api/.env`, sans remplacer les autres
variables. Ne pas mettre ses identifiants dans `.env.example` ni dans Git.

```dotenv
MAIL_TRANSPORT=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USER=ton-adresse@gmail.com
MAIL_PASSWORD=mot_de_passe_application_sans_espaces
MAIL_FROM="Music Room <ton-adresse@gmail.com>"
APP_URL=http://localhost:3000
```

Utiliser la même adresse Gmail dans `MAIL_USER` et `MAIL_FROM` pour ce premier test.
Sur le port 465, TLS est immédiat (`MAIL_SECURE=true`). Pour le port 587, utiliser
`MAIL_SECURE=false` : le backend exige alors STARTTLS. Les certificats sont vérifiés.
[Documentation Nodemailer](https://nodemailer.com/smtp).

`APP_URL` est l'adresse de l'API accessible depuis le navigateur qui ouvre le lien.
`localhost` fonctionne sur le Mac hébergeant l'API. Sur un téléphone, utiliser
l'adresse réseau accessible du Mac. En déploiement, utiliser l'adresse HTTPS publique.

## 3. Recharger et vérifier

Depuis `music-room-api`, Docker démarré :

```bash
make
docker compose exec backend npm run mail:check
docker compose exec backend npm run mail:test
```

`make` installe les nouvelles dépendances dans l'image et recrée les volumes
anonymes des dépendances ; le volume nommé PostgreSQL est conservé.
`mail:check` vérifie connexion et authentification sans envoyer d'email.
`mail:test` vérifie la connexion puis envoie un email à l'adresse `MAIL_USER`
(cette commande de test suppose un identifiant SMTP qui est une adresse email,
comme Gmail). Vérifier la réception, y compris dans les spams : l'acceptation
par le serveur SMTP ne garantit pas l'arrivée dans la boîte principale.

Après une modification de `.env` seule :

```bash
docker compose up -d --no-deps --force-recreate backend
```

Un simple `docker compose restart` ne recharge pas les variables de `env_file`.

## 4. Tester l'authentification dans Swagger

1. Ouvrir http://localhost:3000/docs.
2. Appeler `POST /auth/register` avec une adresse consultable, un nom et un mot
   de passe d'au moins 8 caractères. Si le compte existe déjà mais n'est pas
   vérifié, utiliser `POST /auth/resend-verification` avec son `email`.
3. Ouvrir l'email reçu, puis le lien de vérification depuis le Mac. L'API répond
   « Email vérifié avec succès ».
4. Appeler `POST /auth/login` avec cette adresse et ce mot de passe.
5. Pour tester le reset, appeler `POST /auth/forgot-password`. Le formulaire
   web/mobile n'existe pas encore : récupérer le paramètre `token` dans le lien
   reçu, puis l'envoyer avec `newPassword` à `POST /auth/reset-password` dans Swagger.

Le mode SMTP ne nécessite ni client OAuth Google ni changement de schéma Prisma.

## Diagnostic

- `EAUTH` : vérifier le compte et le mot de passe d'application ; un changement
  du mot de passe Google révoque les mots de passe d'application existants.
- `ETIMEDOUT`, `ECONNECTION`, `EDNS`, `ESOCKET`, `ETLS` : vérifier le réseau, le nom
  d'hôte et la paire port/TLS. Ne pas désactiver la validation des certificats.
- Inscription en 503 : le compte peut déjà être créé ; corriger SMTP et demander
  le renvoi de vérification au lieu de recréer le compte.
- Réponse générique au renvoi/reset : elle ne prouve pas la livraison. Vérifier
  les spams et `make logs`. Les erreurs SMTP y sont indiquées par code uniquement.

Les tests automatisés simulent SMTP et n'envoient aucun email externe.
