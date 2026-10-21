# Sillage 1.3.0

Lecteur de musique personnel installable depuis Safari sur l’écran d’accueil de l’iPhone, sans App Store ni abonnement.

**Application : https://nostranojojosus.github.io/sillage-musique/**

## Profil personnel et liens YouTube / Spotify

**Connecter mon iPhone** ouvre directement le QR privé du PC. Les réglages du profil
affichent un ID stable `SLG-…`, un nom et une association mémorisée.
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

En mode direct, sur l’iPhone associé, le lien est envoyé au PC par la connexion authentifiée. En mode HTTPS, ajoutez les liens YouTube et Spotify sur le PC : les nouveaux MP3 suivent ensuite la synchronisation. Le PC,
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
2. Lancer **Demarrer-Sillage.cmd**, puis choisir **Connecter mon iPhone → Activer la connexion HTTPS gratuite**. Sans profil existant, choisir d’abord **Connecter mes appareils → Préparer ce PC**. Garder la petite fenêtre du compagnon PC ouverte.
3. Scanner ce QR avec l’iPhone, ouvrir le lien dans Safari et toucher **Recevoir ma musique**. Si Sillage est installé depuis l’écran d’accueil, coller le lien privé dans **Connecter mes appareils** depuis cette icône ; le navigateur et l’application installée peuvent avoir des bibliothèques séparées.
4. Garder Sillage ouvert sur les deux appareils. Les ajouts et les playlists sont vérifiés toutes les dix secondes. Attendre **À jour** avant de partir.

La connexion HTTPS utilise un **Cloudflare Quick Tunnel gratuit**, sans compte ni carte bancaire. Le logiciel `cloudflared` est installé localement par `Installer-outils.cmd` depuis son dépôt officiel, avec vérification SHA-256. Le relais permet de recevoir la musique sans liaison WebRTC directe. Une connexion Internet est nécessaire ; le Wi-Fi évite de consommer le forfait mobile pendant la copie.

**Limites du service gratuit :** l’adresse change à chaque redémarrage du tunnel. Il faut alors scanner le nouveau QR ou coller le lien complet du PC. La clé seule ne contient pas l’adresse HTTPS. Quick Tunnels est un service temporaire sans garantie de disponibilité. Le cache chiffré du PC est limité à 2 Go. iOS peut suspendre la copie en arrière-plan : garder Sillage visible jusqu’à « À jour ». Un iPhone physique reste nécessaire pour valider son comportement réel, notamment l’écoute écran verrouillé.

La synchronisation vérifie les ajouts toutes les dix secondes. Une coupure reprend automatiquement avec la même adresse ; un changement d’adresse demande un nouveau QR. **Mettre la synchronisation en pause** sur le PC ferme le tunnel. Fermer le lanceur arrête aussi le partage. L’ancien mode direct reste disponible pour les profils qui l’utilisent déjà.

Après la copie, la musique reste disponible sur l’iPhone, même sans réseau et avec le PC éteint. Elle utilise donc le stockage de l’iPhone.

## Données

- Morceaux et playlists conservés dans IndexedDB, sur chaque appareil.
- Le dépôt et GitHub Pages ne reçoivent aucun morceau, playlist ou code d’association.
- En HTTPS, le catalogue et les morceaux sont chiffrés dans le navigateur PC (AES-GCM avec une clé dérivée du secret du profil). Cloudflare relaie les données chiffrées et voit les informations de connexion et le volume transféré. Il ne reçoit pas la clé de déchiffrement.
- Le tunnel expose seulement un serveur de téléchargement dédié, authentifié et limité aux données chiffrées. Le convertisseur, son API locale et les autres fichiers du PC ne sont pas exposés. Le cache `pc/sync-cache` est exclu des archives distribuées.
- En mode direct, la liaison WebRTC est chiffrée et authentifiée ; PeerJS Cloud et STUN aident à joindre les appareils et voient leurs informations de connexion.
- Les noms et le contenu des playlists suivent le PC ; les favoris de l’iPhone restent locaux.
- Les suppressions sur le PC n’effacent pas les copies déjà présentes sur l’iPhone. Un titre supprimé seulement du téléphone sera recopié s’il reste sur le PC associé.
- Un morceau interrompu ou endommagé n’est pas enregistré ; les morceaux terminés restent disponibles et ne sont pas retransmis.
- Conserver une sauvegarde : le nettoyage des données du navigateur peut supprimer la bibliothèque et l’association.

## Mise à jour

Si **Connecter mon iPhone** n’apparaît pas sur le PC déjà associé, ouvrir Sillage en ligne, recharger, attendre quelques secondes, puis recharger encore. Ne pas effacer les données du site.

PeerJS 1.5.5 est distribué localement avec sa licence MIT dans `PEERJS-LICENSE.txt`. Aucun code tiers n’est chargé depuis un CDN à l’exécution.

Documentation du relais : [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
