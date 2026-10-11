# Music Room : progression par rapport au sujet

Lecture du `musicroom.pdf` fourni localement, version 6, le 9 octobre 2026.
Le tableau distingue le code disponible de la validation réelle sur appareil.
Il décrit cette branche ; les travaux distants du coéquipier ne sont pas présumés terminés.

| Exigence | État constaté | Travail restant |
|---|---|---|
| IV.1 — architecture justifiée, dépendances installables | Backend Docker/Make ; mobile `npm ci` ; note TECH-CHOICES | Vérifier un clone neuf et compléter les choix temps réel avec le coéquipier |
| IV.2 — toutes les actions dans une application Android **ou** iOS | Base Expo commune aux deux plateformes | Recette sur une plateforme au minimum ; exports JS seuls insuffisants |
| V.1 — inscription email, vérification, oubli du mot de passe | Backend SMTP testé manuellement ; formulaires mobiles disponibles | Tester le parcours mobile complet et l’ouverture des liens email |
| V.1 / V.5 — inscription/connexion sociale et liaison explicite | Google/Facebook validés côté backend ; code Google natif ajouté le 10 octobre | Configurer les clients natifs, compiler et tester Google ; Facebook natif à intégrer |
| V.1 — modifier public, amis, privé, préférences musicales | Éditeur mobile ajouté ; préférences sous forme de genres ; API existante | Recette sur appareil avec deux comptes et vérification après reconnexion |
| V.2.3 — amis et personnes aux mêmes goûts | Recherche nom/genre, demandes et profils filtrés ajoutés au mobile | Recette réelle des demandes réciproques, suppression et visibilité |
| V.2.1 — Track Vote | Backend A8/A9 intégré, tests de concurrence exécutés lors de la revue | Écrans de recherche, suggestion, vote, lecture ; événements temps réel et tests des licences |
| V.2.3 — Playlist Editor | API et permissions existantes | Interface playlists/invitations, collaboration temps réel, réordonnancement et traitement des conflits 409 |
| V.3 — backend source de vérité | Mobile utilise l’API, sans base métier locale ; tokens seulement dans SecureStore | Conserver cette règle pour les prochains écrans |
| V.4 — documentation des méthodes, entrées, sorties | Swagger et guides disponibles | Compléter les réponses/exemples d’erreurs, coordination A11 |
| V.5 — adresse du backend configurable | Écran Serveur, session liée à l’origine | Tester sur téléphone avec IP locale et sur serveur HTTPS |
| V.6 — sécurité et journaux des actions | Sessions/permissions testées ; appareils et logs côté serveur ; header après enregistrement | Vérifier les logs avec une vraie plateforme, le modèle exact et la version ; couverture des actions avant authentification et en cas d’échec d’enregistrement à compléter |
| V.7 — montée en charge et caractéristiques machine | Non démontrées par les tests fonctionnels | Mesures de charge, concurrence et rapport avec CPU/RAM/configuration, à coordonner |
| V.8 — tests par couche, collaboration et secrets locaux | Tests backend/mobile, workflows CI, `.env` ignorés | Surveiller les résultats CI, revue humaine et recette mobile |
| II — transparence de l’usage de l’IA | Note AI-USAGE disponible | Relecture/compléments des deux auteurs ; pouvoir expliquer le code |

## Ordre de travail retenu pour la partie mobile auth/social

1. Profils modifiables, recherche, amis et visibilité : code ajouté, recette appareil à faire.
2. Connexion et liaison Google natives : code ajouté ; client iOS, compilation et recette
   encore requis. Voir [Google natif](GOOGLE-NATIVE.md). Facebook natif reste à intégrer.
3. Invitations et gestion des appareils ; compléter la traçabilité des actions.
4. Intégration des écrans Track Vote et Playlist Editor avec le travail musique/temps réel.
5. Recette complète, documentation des réponses, essais de charge et vérification depuis un clone neuf.

Les deux services choisis sont Track Vote et Playlist Editor. Le § V.2 exige au
moins deux services parmi trois ; la délégation n’est donc pas nécessaire à ce choix.
Le § V.7 mentionne néanmoins trois services dans sa formulation : documenter explicitement
les deux services livrés et les mesures réalisées, sans inventer de résultats pour le troisième.
Le sujet exige une plateforme mobile ; Android et iOS restent l’objectif de l’équipe.
Les bonus web, IoT, abonnements et hors ligne passent après la partie obligatoire.

## Limites de validation actuelles

- TypeScript, tests avec API simulée et exports JS ne prouvent pas l’ergonomie ni les SDK natifs.
- Le 10 octobre 2026, compilation iOS réussie et Sonora affichée sur iPhone 18 Pro / iOS 27.
  La recette de connexion Google reste à effectuer dans l’application native.
- La confidentialité est imposée par le backend. Le mobile affiche uniquement les
  sections prévues pour les profils d’autrui ; il ne doit jamais décider lui-même d’une amitié.
- Un profil consulté est rechargé depuis le serveur à chaque ouverture ; les listes ont
  un bouton d’actualisation. Il n’y a pas encore de rafraîchissement social temps réel.
