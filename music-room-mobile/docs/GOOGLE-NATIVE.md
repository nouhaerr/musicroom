# Google dans Sonora : connexion et liaison

Le code mobile utilise `react-native-nitro-google-signin` (Credential Manager sur
Android et Google Sign-In sur iOS), sans Firebase. Une version de développement
compilée est nécessaire. Expo Go reste utilisable pour les parcours email et social
hors Google ; le bouton Google y affiche une explication sans charger le module natif.

## 1. Créer le client iOS

Dans [Google Cloud Console](https://console.cloud.google.com/), sélectionner le même
projet que celui du client Web déjà utilisé par le backend. Aller dans
**Google Auth Platform → Clients → Créer un client** :

| Champ | Valeur |
|---|---|
| Type d’application | iOS |
| Nom | Sonora iOS |
| Identifiant de bundle | `com.sonora.musicroom` |

Ne pas remplacer le client Web existant. Si Google demande un identifiant App Store
ou une équipe Apple, ne pas inventer de valeur ; le test local n’est pas une publication
sur l’App Store. Utiliser les valeurs réelles si le compte en dispose.

Copier l’ID client obtenu, qui se termine par `.apps.googleusercontent.com`, dans
`music-room-mobile/.env` :

```dotenv
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=COLLER_L_ID_CLIENT_IOS_ICI
```

`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` doit correspondre exactement au `GOOGLE_CLIENT_ID`
du backend. Le fichier local a été préparé avec cet ID Web. Sur un autre clone,
copier `.env.example` puis renseigner
les deux identifiants. Aucun **client secret**, secret JWT ou mot de passe SMTP dans le mobile.
Les IDs clients sont publics dans l’application compilée, même s’ils restent hors Git.

Le bundle est déclaré dans `app.json`. `app.config.ts` calcule le schéma d’URL inversé
à partir de l’ID iOS et active les plugins correspondants. Un plugin local transmet
le retour OAuth à Google en conservant les autres liens Sonora/Expo.

## 2. Compiler sur le Mac

Ouvrir Xcode et terminer sa première configuration, y compris la licence et
l’installation d’un simulateur iOS. CocoaPods doit aussi être disponible (`brew install
cocoapods` si nécessaire). Sur le Mac de développement, Xcode 27 et le simulateur
iOS 27 sont disponibles. `expo-build-properties` active `enableSceneSupport` pour
Expo SDK 57 ; sans ce réglage, iOS 27 refuse le démarrage. Les retours Google et
les autres liens passent par le relais de scènes d’Expo vers l’AppDelegate.

Dans le dossier mobile :

```sh
npm ci
npm run dev:ios
```

Cette commande vérifie les IDs puis génère/compile le projet natif et ouvre le
simulateur. Pour relancer Metro avec la version déjà installée : `npm run start:dev`.
Après le prebuild, `npm run ios` et `npm run android` sont des raccourcis de compilation
générés par Expo. Préférer `dev:ios` / `dev:android` pour vérifier les IDs avant de compiler.
Après un changement d’ID iOS ou de plugin, régénérer avec
`npx expo prebuild --platform ios`, puis relancer `npm run dev:ios`.
Les dossiers natifs générés restent ignorés par Git.

## 3. Android

Créer aussi un client OAuth **Android**, même projet Google, package
`com.sonora.musicroom`, avec le SHA-1 du certificat qui signe effectivement la build.
Le SDK Android, Java, un émulateur avec Google Play Services et le certificat de
test sont nécessaires. Utiliser `npm run dev:android`, puis le rapport de signature
Gradle (`./gradlew signingReport` dans le dossier `android` généré) pour obtenir
l’empreinte réelle. Aucun ID client Android n’est envoyé à la place de l’ID Web.
Les builds distribuées peuvent employer un autre certificat : configurer leur SHA-1 aussi.

## Parcours et recette

- **Continuer avec Google** : choix explicite du compte ; seul l’ID token va à
  `POST /auth/google`. Le backend vérifie signature/audience/expiration/email, puis
  émet une session Sonora. Le refresh Sonora seul est conservé dans SecureStore.
- **409 sur email existant** : aucune liaison automatique. Se connecter avec la
  méthode habituelle, ouvrir **Mon profil → Lier Google**, confirmer puis choisir
  le compte. `POST /auth/link/google` utilise la session et l’appareil Sonora courants.
- Une annulation n’envoie rien au backend ; une session fermée pendant le choix du
  compte empêche l’envoi tardif. La liaison à un Google appartenant à quelqu’un
  d’autre laisse la session Sonora actuelle intacte et affiche le conflit.
- Après liaison, se déconnecter et retester Google. Vérifier qu’aucun second utilisateur
  n’a été créé. Tester également un compte Google encore inconnu, une annulation,
  une panne réseau et la restauration de session après redémarrage.

Le 10 octobre 2026, la compilation iOS a réussi et Sonora s’est affichée sur le
simulateur iPhone 18 Pro / iOS 27. Le premier lancement a nécessité de rouvrir
le lien Expo après un délai d’ouverture dépassé. Si `--localhost` écoute uniquement
sur `::1` alors que l’application demande `127.0.0.1`, relancer Metro avec
`npm run start:dev -- --lan --port 8082`, puis ouvrir dans le client de développement
`http://127.0.0.1:8082`. Le backend doit être démarré séparément pour tester les comptes.

La connexion native réelle reste **à valider**. Les tests utilisent un SDK et un
réseau simulés ; l’export JS n’est pas une compilation iOS/Android. Le schéma iOS
a été vérifié avec un ID fictif via la configuration Expo ; le vrai retour navigateur
doit être testé dans la build. Aucun bouton de dissociation n’est ajouté : le backend
ne fournit pas cette opération. Facebook natif reste une étape distincte.

Références : [Expo Google](https://docs.expo.dev/guides/google-authentication/),
[installation native](https://react-native-nitro-google-sign-in.github.io/docs/setup/expo/),
[flux Google et vérification serveur](https://react-native-nitro-google-sign-in.github.io/docs/guide/usage/).
