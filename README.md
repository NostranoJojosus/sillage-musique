# Sillage 1.2

Lecteur de musique personnel installable depuis Safari sur l’écran d’accueil de l’iPhone, sans App Store ni abonnement.

**Application : https://nostranojojosus.github.io/sillage-musique/**

## Profil personnel et liens YouTube / Spotify

**Mon profil** affiche un ID stable `SLG-…`, un nom et une association mémorisée.
L’ancienne clé de synchronisation est conservée. Le lien privé ou la clé permet de
retrouver le profil sur un autre appareil ; l’ID seul n’accorde pas l’accès. Un QR
est généré localement. Ce profil est une association privée entre appareils,
pas un compte avec stockage en ligne. Garder sa clé et une sauvegarde de sa musique.

**Ajouter un lien YouTube** accepte une vidéo et l’ajoute automatiquement en MP3.
Sur le PC, lancer `Demarrer-Sillage.cmd`, puis **Activer le convertisseur PC** dans
le lecteur habituel. Garder la petite fenêtre du convertisseur ouverte. Les fichiers
restent dans la bibliothèque habituelle du site ; aucun téléchargement/réimport manuel
n’est nécessaire. Le menu d’un morceau permet aussi d’**Exporter le fichier audio**.

La connexion au convertisseur appartient à l’onglet et au navigateur utilisés.
Depuis la version 1.2.3, **Convertir et ajouter à ma musique** et la recherche Spotify
ouvrent cette connexion au clic si nécessaire. Garder la fenêtre ouverte et autoriser
son ouverture pour ce site si le navigateur la bloque. Soumettre à nouveau un lien
déjà en attente reprend la demande existante sans la doubler. Cela n’efface aucune musique.

Sur l’iPhone associé, le lien est envoyé au PC par la connexion authentifiée. Le PC,
son convertisseur et les deux lecteurs doivent être ouverts. Les liens en attente
restent mémorisés sur l’appareil qui les reçoit. Aucun convertisseur payant n’est utilisé.
La version GitHub Pages seule ne convertit pas la vidéo ; yt-dlp, FFmpeg et Deno
s’exécutent sur le PC. Une vidéo par lien, une heure et 100 Mo maximum. Utiliser ses
vidéos ou des contenus dont le téléchargement est autorisé. YouTube peut bloquer l’accès.

**Spotify → versions YouTube** garde vos références de morceaux, artistes et playlists.
Pour un morceau ou artiste, le PC consulte le titre public fourni par l’API oEmbed
officielle de Spotify, puis recherche cinq versions sur YouTube. Vérifiez le titre,
la chaîne et la durée, puis choisissez **Convertir cette version en MP3**. Le fichier
provient de YouTube, pas de Spotify. Aucun abonnement ni compte Spotify n’est nécessaire
pour cette consultation publique. Le titre peut être corrigé manuellement si la référence
est indisponible ou ambiguë. Pour les playlists, la liste complète n’est pas récupérée :
saisissez le nom et l’artiste de chaque morceau à retrouver. Rien n’est téléchargé
avant le choix d’une version. Les références du PC suivent sa synchronisation ; celles
ajoutées seulement sur l’iPhone restent locales.

La liaison au convertisseur reste limitée au PC (127.0.0.1). Les messages entre fenêtres
vérifient leur origine, leur fenêtre d’origine et un jeton temporaire. Les demandes de
conversion sont enregistrées localement avec un identifiant pour éviter les doublons.
Le jeton de l’API locale n’est pas communiqué au site. Le lien du profil utilise un
fragment d’adresse, retiré par l’application et non transmis à GitHub.

Les essais sur un iPhone physique restent nécessaires, notamment la connexion WebRTC,
les demandes YouTube à distance et la lecture écran verrouillé.
qrcode-generator 1.4.4 est distribué sous licence MIT et chargé localement.

## Synchroniser du PC vers l’iPhone

1. Sur le PC, ouvrir la bibliothèque contenant les morceaux dans le navigateur habituel.
2. Choisir **Mon profil → Créer mon profil sur ce PC**.
3. Sur l’iPhone, ouvrir Sillage depuis son icône, choisir **Mon profil**, puis saisir une fois le code affiché sur le PC.
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

Si **Mon profil** n’apparaît pas, ouvrir Sillage en ligne, recharger, attendre quelques secondes, puis fermer et rouvrir. Ne pas effacer les données du site.

PeerJS 1.5.5 est distribué localement avec sa licence MIT dans `PEERJS-LICENSE.txt`. Aucun code tiers n’est chargé depuis un CDN à l’exécution.
