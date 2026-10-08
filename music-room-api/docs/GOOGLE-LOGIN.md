# Google Login — backend et application Expo

Le backend reçoit un **ID token Google** dans `POST /auth/google`, le valide avec
`google-auth-library`, puis renvoie ses propres `accessToken`, `refreshToken` et
`user`. Les contrôles portent sur signature, audience, émetteur, expiration et
email vérifié. Les clés publiques Google sont mises en cache. Aucun token n'est
envoyé à `tokeninfo` ni inscrit dans les logs de ce fournisseur.

## Client Web et configuration du backend

Dans [Google Cloud Console](https://console.cloud.google.com/), sélectionner le
projet Sonora, puis Google Auth Platform. Configurer Branding et Audience
(externe pour les comptes personnels). Si l'application est en mode test,
ajouter les comptes de l'équipe dans les utilisateurs de test si nécessaire.
Seuls les scopes de connexion `openid`, `email`, `profile` sont utiles ici.

Dans Clients, créer un client **Application Web** nommé `Sonora Backend`.
Son identifiant est l'audience attendue par le backend et sera aussi le
`webClientId` du SDK mobile : le type Web est donc volontaire, même pour Android/iOS.

Dans `.env` du backend :

```dotenv
GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID=IDENTIFIANT_WEB.apps.googleusercontent.com
```

Le flux utilise l'ID token : `GOOGLE_CLIENT_SECRET` et `GOOGLE_CALLBACK_URL` ne
sont pas utilisés. Aucune route `/auth/google/callback` n'est nécessaire.
Les identifiants SMTP Gmail restent indépendants de Google Login.

Après les nouvelles dépendances : `make`. Après modification de `.env` seule :

```bash
docker compose up -d --no-deps --force-recreate backend
```

## Test dans le navigateur, avant le mobile

Dans le client Web, ajouter aux **origines JavaScript autorisées** :

```text
http://localhost
http://localhost:8085
```

Ce test utilise un callback JavaScript dans une fenêtre Google : laisser les
URI de redirection vides si aucun autre flux n'en a besoin. Il faut parfois
attendre la propagation d'un changement de configuration Google.

Depuis `music-room-api`, sur le Mac avec Node 22 et les dépendances installées :

```bash
npm run google:test
```

Ouvrir **http://localhost:8085**, choisir son compte Google, puis cliquer sur
**Tester la connexion à Sonora**. Cette action peut créer un compte et ouvre
une session dans la vraie base locale. La page indique le résultat sans afficher
les tokens de session. Le volet Swagger permet de copier le JSON `{ "idToken": "..." }`.
Fermer la page et arrêter le serveur avec Ctrl+C à la fin.

Cet outil écoute uniquement sur la boucle locale du Mac. Il expose l'ID client
public et `APP_URL`, jamais le contenu de `.env`. Aucun token n'est écrit sur
disque ou dans localStorage. Il teste le backend avec Google, sans remplacer
les futurs tests sur Android et iOS.

### Compte email existant : 409 attendu

Si l'email Google appartient déjà à un compte créé par mot de passe, le backend
refuse la fusion automatique. Dans Swagger :

1. Appeler `POST /auth/login` avec ce compte.
2. Copier son accessToken Sonora dans **Authorize**.
3. Appeler `POST /auth/link/google` avec le JSON ID token copié depuis la page.
4. Retester `POST /auth/google` : la connexion doit maintenant réussir.

Un ID client n'est pas un ID token : le premier identifie l'application, le
second est obtenu après la connexion de l'utilisateur à Google.

## Préparation Expo Android/iOS

Le projet Expo est le dossier du frontend mobile (écrans, navigation, boutons),
avec `app.json` ou `app.config.*`. Il n'est pas présent dans ce dépôt à ce stade.
Le SDK Google natif nécessite une development build Expo ; Expo Go ne suffit pas.

Créer les clients natifs dans **le même projet Google Cloud**, une fois leurs
identifiants connus :

| Client OAuth | Valeurs nécessaires | Utilisation |
|---|---|---|
| Web | ID client déjà créé | Backend `GOOGLE_CLIENT_ID` et mobile `webClientId` |
| Android | `android.package` et SHA-1 du certificat signant la build testée | Reconnaissance de l'application Android |
| iOS | `ios.bundleIdentifier` | Client iOS et schéma d'URL inversé du plugin Expo |

Pour Android, la signature locale, la build EAS et la signature Play Store
peuvent différer : configurer les empreintes des builds effectivement utilisées.
Pour iOS sans Firebase, le plugin `@react-native-google-signin/google-signin`
utilise `iosUrlScheme`, fourni par le client iOS Google.

Lors de l'intégration mobile, configurer le SDK avec le client Web commun et le
client iOS. Transmettre son `idToken` au backend, puis utiliser les JWT Sonora
pour les autres routes. Sérialiser les refresh et conserver le refresh token
dans le stockage sécurisé de la plateforme. Ne mettre aucun secret OAuth ou SMTP
dans les variables publiques Expo.

## Erreurs utiles

- 400 : corps JSON invalide (token vide ou trop long notamment).
- 401 : signature/claims invalides, token expiré, mauvaise audience ou email non vérifié.
- 409 : compte email déjà présent, liaison explicite nécessaire.
- 503 : Google désactivé ou récupération des clés publiques indisponible.
- Erreur Google « origin not allowed » : vérifier les origines du **client Web**,
  et ouvrir exactement `http://localhost:8085`.

Les tests du fournisseur utilisent de vraies signatures RSA et remplacent
uniquement le téléchargement des certificats. Ils couvrent notamment une mauvaise
signature, audience, expiration ou identité, et l'indisponibilité des clés.

Références : [validation serveur Google](https://developers.google.com/identity/sign-in/web/backend-auth),
[configuration Web Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[Expo Google Authentication](https://docs.expo.dev/guides/google-authentication/),
[configuration des clients natifs](https://react-native-google-signin.github.io/docs/setting-up/get-config-file),
[plugin Expo](https://react-native-google-signin.github.io/docs/setting-up/expo).
