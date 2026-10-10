# Pages d’information de Sonora

Site statique autonome, séparé de `music-room-api`. Aucun accès à la base de données,
aucun script et aucune lecture du fichier `.env`.

## Fichiers

- `index.html` : accueil.
- `privacy-policy.html` : brouillon de politique de confidentialité.
- `data-deletion.html` : brouillon des instructions de suppression par email.
- `styles.css` : présentation commune adaptée aux téléphones.

## Consulter en local

Depuis la racine du dépôt :

```sh
python3 -m http.server 8086 --bind 127.0.0.1 --directory sonora-legal
```

- http://127.0.0.1:8086/privacy-policy.html
- http://127.0.0.1:8086/data-deletion.html

Ces adresses sont locales et ne peuvent pas servir d’URL publiques dans Meta.
Le serveur expose uniquement ce dossier, jamais la racine du dépôt ou le backend.

## Avant publication

1. Compléter les mentions « À compléter » avec les informations réelles : responsable,
   hébergement, prestataires, conservation, délai et périmètre de suppression.
2. Confirmer que `grpsonora.music@gmail.com` est surveillée et que l’équipe dispose
   d’une procédure effective pour traiter les demandes de suppression.
3. Vérifier le contenu puis retirer les avertissements de brouillon.
4. Héberger uniquement ce dossier sur un site public HTTPS.
5. Vérifier que les deux pages sont accessibles sans connexion depuis leur URL publique.

Pour Meta, sélectionner le type « instructions de suppression des données » et fournir
l’URL de `data-deletion.html`. Cette page n’est pas un callback automatique de suppression.

Aucun hébergement public ni aucune URL publique active ne sont créés par ces fichiers.
Ce brouillon ne constitue pas une validation juridique ou une approbation Meta.
