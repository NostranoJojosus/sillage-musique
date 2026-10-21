# Sillage

Lecteur de musique personnel installable depuis Safari sur l’écran d’accueil de l’iPhone, sans App Store ni abonnement.

**Application : https://nostranojojosus.github.io/sillage-musique/**

## Synchroniser du PC vers l’iPhone

1. Sur le PC, ouvrir la bibliothèque contenant les morceaux dans le navigateur habituel.
2. Choisir **Synchroniser → Ce PC envoie ma musique**.
3. Sur l’iPhone, ouvrir Sillage depuis son icône, choisir **Synchroniser**, puis saisir une fois le code affiché sur le PC.
4. Garder Sillage ouvert sur les deux appareils. Les ajouts et les playlists sont vérifiés toutes les dix secondes. Attendre **À jour** avant de partir.

Privilégier le même Wi-Fi. Une connexion Internet est nécessaire pour établir la liaison. Les réseaux qui empêchent une connexion WebRTC directe peuvent bloquer la synchronisation, notamment en 4G/5G. Aucun relais payant n’est utilisé. iOS peut suspendre l’application en arrière-plan : la copie n’y est pas garantie. La synchronisation sur un iPhone physique reste à vérifier ; les essais automatisés du protocole ne remplacent pas ce test.

Après la copie, la musique reste disponible sur l’iPhone, même sans réseau et avec le PC éteint. Elle utilise donc le stockage de l’iPhone.

## Données

- Morceaux et playlists conservés dans IndexedDB, sur chaque appareil.
- Le dépôt et GitHub Pages ne reçoivent aucun morceau, playlist ou code d’association.
- Liaison WebRTC chiffrée et authentification mutuelle par le code privé, qui n’est pas envoyé au service de signalisation.
- PeerJS Cloud et un serveur STUN aident à établir la liaison et voient des informations de connexion, dont les adresses IP. Ils n’hébergent pas la musique.
- Les noms et le contenu des playlists suivent le PC ; les favoris de l’iPhone restent locaux.
- Les suppressions sur le PC n’effacent pas les copies déjà présentes sur l’iPhone. Un titre supprimé seulement du téléphone sera recopié s’il reste sur le PC associé.
- Un morceau interrompu ou endommagé n’est pas enregistré ; les morceaux terminés restent disponibles et ne sont pas retransmis.
- Conserver une sauvegarde : le nettoyage des données du navigateur peut supprimer la bibliothèque et l’association.

## Mise à jour

Si **Synchroniser** n’apparaît pas, ouvrir Sillage en ligne, recharger, attendre quelques secondes, puis fermer et rouvrir. Ne pas effacer les données du site.

PeerJS 1.5.5 est distribué localement avec sa licence MIT dans `PEERJS-LICENSE.txt`. Aucun code tiers n’est chargé depuis un CDN à l’exécution.
