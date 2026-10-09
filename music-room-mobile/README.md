# Sonora — première base mobile

Application React Native + Expo SDK 57, TypeScript, Android/iOS.
Ce dossier est indépendant de `music-room-api` : ne pas y copier le `.env` du backend.

## Ce qui est disponible

- Inscription, connexion email, renvoi et validation d’email.
- Demande de réinitialisation et saisie du nouveau mot de passe.
- Lecture de son profil, actualisation et déconnexion.
- Adresse du backend modifiable depuis l’écran **Serveur**, conservée sur l’appareil.
- Refresh token dans Expo SecureStore ; access token uniquement en mémoire.
- Un seul renouvellement partagé entre les requêtes concurrentes ; pas de boucle de retry.
- Enregistrement de l’appareil après authentification, puis header `X-Device-Id`
  sur les requêtes authentifiées quand l’identifiant est disponible.

Les écrans amis/invitations, édition et consultation des profils d’autrui, ainsi
que Google/Facebook natifs ne sont pas encore implémentés. Les tests de confidentialité
backend existent ; ils ne constituent pas une validation de ces futurs écrans.

## Démarrer

1. Lancer le backend depuis `music-room-api` avec `make`.
2. Depuis ce dossier, avec Node 22 et npm :

   ```sh
   npm ci
   npm start
   ```

3. Ouvrir avec une version d’Expo Go compatible SDK 57 sur Android/iOS, ou dans
   un simulateur déjà installé (`npm run ios` / `npm run android`). La connexion
   par email utilise les modules fournis par Expo Go ; les SDK sociaux natifs
   demanderont une development build dédiée.
4. Appuyer sur **Serveur** et enregistrer l’adresse adaptée :

| Environnement | Adresse locale habituelle |
|---|---|
| Simulateur iOS sur le Mac du backend | `http://localhost:3000` |
| Émulateur Android standard | `http://10.0.2.2:3000` |
| Téléphone physique sur le même Wi-Fi | `http://<IP-locale-du-Mac>:3000` |

Sur un téléphone, `localhost` désigne le téléphone. Le pare-feu et le réseau
doivent autoriser la connexion au Mac. Pour vérifier l’accessibilité, ouvrir
`http://<IP-locale-du-Mac>:3000/docs` dans son navigateur. Utiliser HTTPS hors du
réseau de développement. Le port 3000 est déjà publié par Docker Compose.

L’adresse initiale peut aussi être fournie via `EXPO_PUBLIC_API_URL` dans un
`.env` mobile inspiré de `.env.example`. Une adresse enregistrée depuis l’écran
Serveur est prioritaire. Changer de serveur ferme la session locale pour éviter
d’envoyer des tokens d’un environnement à un autre.

## Emails et liens

L’email de vérification actuel ouvre le backend. Après validation, revenir dans
l’application et choisir **J’ai vérifié mon email**. Il est aussi possible de
coller le lien complet dans l’écran de vérification.

Pour réinitialiser : **Mot de passe oublié ?**, demander l’email, puis **J’ai reçu
le lien** et coller le lien reçu. L’app en extrait seulement le token et appelle
`POST /auth/reset-password` sur son serveur configuré. Elle ne télécharge jamais
l’URL collée. Le backend n’a pas de page GET de reset : copier le lien depuis
l’email plutôt que d’attendre un formulaire dans le navigateur.

Le schéma `sonora` est déclaré pour une future development build. Les chemins
`sonora://auth/verify-email?token=…` et `sonora://auth/reset-password?token=…`
préparent l’écran correspondant, sans consommer automatiquement le token. Les
emails backend n’ont pas été modifiés pour envoyer ces liens ; les Universal Links /
App Links HTTPS et la configuration native restent à faire. Expo Go ne remplace
pas cette configuration.

## Sessions et appareils

Le refresh token sauvegardé est lié à l’adresse du serveur. Avant un refresh,
il est supprimé du stockage ; le nouveau n’est enregistré qu’après réponse valide.
Si le réseau coupe pendant le renouvellement, l’app demande une nouvelle connexion
plutôt que rejouer un token potentiellement consommé (ce qui révoquerait toutes
les sessions côté backend). Conséquence : une ouverture hors ligne avec une session
enregistrée demande une reconnexion une fois le réseau revenu. Pas de mode hors ligne.

La déconnexion efface la session locale et tente sa révocation serveur. Si celle-ci
n’est pas confirmée, l’utilisateur en est informé ; aucune révocation distante
n’est prétendue réussie. Un reset réussi ferme aussi la session locale.

`POST /devices` exige un JWT : l’enregistrement intervient après connexion ou
restauration, pas avant. L’identifiant conservé est associé au serveur et à
l’utilisateur. Le premier appel d’enregistrement n’a pas encore de `X-Device-Id`.
En cas d’échec, l’authentification reste utilisable et un message annonce le nouvel
essai à la prochaine connexion. Les appareils supprimés côté serveur et le
renouvellement de leur enregistrement restent à traiter dans le futur écran appareils.

## Vérifications

Validation locale du 9 octobre 2026 : TypeScript, 15 tests du client et export
Android/iOS réussis ; `expo-doctor` valide ses 21 contrôles après déduplication
des dépendances. Les alertes d’audit décrites plus bas restent présentes.

```sh
npm run typecheck
npm test
npm run export:native
```

Les tests du client utilisent fetch et le stockage simulés : courses de refresh,
réponses 401 tardives, échec réseau/stockage, logout pendant un refresh, reset,
origine du serveur et enregistrement d’appareil. Le refus 403 est conservé sans
renouveler la session ; le filtrage des profils reste contrôlé côté backend.

L’export produit les bundles Android/iOS ; ce n’est pas une compilation APK/IPA
ni un test sur appareil. La recette Android et iOS reste **à exécuter** :

1. Configurer le serveur et tester inscription → email → vérification → login.
2. Vérifier le profil puis fermer/rouvrir l’app : restauration et rotation.
3. Vérifier dans Swagger que l’appareil est enregistré pour le bon compte.
4. Tester logout, retour à la connexion, puis reset et ancien mot de passe refusé.
5. Couper le réseau pendant une action : message compréhensible, pas de boucle.
6. Vérifier clavier, scroll, boutons et liens sur les deux plateformes.

Le workflow `mobile-ci.yml` est préparé pour typecheck, tests et export. Il ne
constitue pas encore une exécution GitHub réussie de cette nouvelle branche.

## Dépendances et prochaines étapes

L’audit initial du modèle Expo (8 octobre 2026) signale 22 entrées : 15 élevées et
7 modérées, liées notamment à `braces`, `node-forge` et `uuid` dans les chaînes
d’outillage Metro/Expo/Xcode. Ce nombre inclut les paquets indirectement impactés.
Les versions publiées vérifiées de braces (3.0.3), node-forge (1.4.0) et xcode
(3.0.1) n’apportent pas les corrections recherchées. Aucun downgrade Expo/React
Native ni override majeur non validé n’a été appliqué. Réévaluer avant distribution.

Choisir les identifiants Android/iOS avec l’équipe, configurer Google et Meta,
ajouter les SDK et construire une development build avant de tester les connexions
sociales natives. Ne jamais embarquer les secrets JWT, SMTP ou Facebook du serveur.

Références : [création Expo](https://docs.expo.dev/more/create-expo/),
[SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/),
[Google natif](https://docs.expo.dev/guides/google-authentication/),
[Facebook natif](https://docs.expo.dev/guides/facebook-authentication/).
