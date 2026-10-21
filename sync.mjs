import {SyncSession, newCode, normalizeCode, displayCode, sourceId} from './sync-protocol.mjs';
import {profileId,profileName,invitation,readInvitation,renderProfileQR} from './profile.mjs';

const SETTINGS='sillage-sync-v1';
let peerScript;
async function loadPeer() {
  if(window.Peer)return window.Peer;
  if(!peerScript)peerScript=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL('./peerjs.min.js',import.meta.url).href;
    script.onload=()=>resolve(window.Peer);script.onerror=()=>{peerScript=null;script.remove();reject(Error('La synchronisation doit être préparée une première fois en ligne.'));};document.head.append(script);
  });
  return peerScript;
}

export class SyncManager extends EventTarget {
  constructor(store) {
    super();this.store=store;this.sessions=new Set();this.status={text:'Relier le PC et l’iPhone',kind:'off'};this.generation=0;this.attempts=0;
    try{const s=JSON.parse(localStorage.getItem(SETTINGS));if(s && ['source','receiver'].includes(s.role)){normalizeCode(s.code);this.settings=s;}}catch{}
    window.addEventListener('online',()=>{if(this.settings?.enabled)this.start();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible' && this.settings?.enabled){if(this.receiver?.authorized)this.receiver.requestSync().catch(()=>this.retry());else if(!this.peer || this.peer.destroyed || this.peer.disconnected)this.start();}});
    window.addEventListener('storage',event=>{if(event.key===SETTINGS){this.stop();this.settings=null;this.state('Réglage modifié dans un autre onglet. Rechargez cette page.','off');}});
    window.addEventListener('pagehide',()=>this.stop());
    window.addEventListener('pageshow',event=>{if(event.persisted && this.settings?.enabled)this.start();});
  }
  state(text,kind='waiting',extra={}) {this.status={text,kind,...extra};this.dispatchEvent(new Event('change'));}
  save() {localStorage.setItem(SETTINGS,JSON.stringify(this.settings));}
  async configure(role,code,name) {
    const next={role,code:normalizeCode(code||newCode()),name:profileName(name||this.settings?.name),enabled:true};
    localStorage.setItem(SETTINGS,JSON.stringify(next));this.settings=next;this.attempts=0;await this.start();
  }
  rename(name){if(!this.settings)return;this.settings.name=profileName(name);this.save();this.state(this.status.text,this.status.kind,this.status);}
  pause() {if(!this.settings)return;this.settings.enabled=false;this.save();this.stop();this.state('Synchronisation en pause','off');}
  resume() {if(!this.settings)return;this.settings.enabled=true;this.save();this.attempts=0;this.start();}
  forget() {localStorage.removeItem(SETTINGS);this.stop();this.settings=null;this.state('Appareils dissociés · morceaux conservés','off');}
  stop() {
    ++this.generation;clearTimeout(this.retryTimer);clearTimeout(this.connectTimer);clearInterval(this.pollTimer);
    const sessions=[...this.sessions];this.sessions.clear();this.receiver=null;
    for(const session of sessions)session.close();
    const peer=this.peer;this.peer=null;peer?.destroy();
  }
  retry(message) {
    if(!this.settings?.enabled)return;
    this.stop();this.attempts++;const delay=Math.min(30000,5000*this.attempts);
    this.state(message || (this.settings.role==='receiver'?'En attente du PC · nouvelle tentative automatique':'Reconnexion au service de liaison…'),'waiting');
    this.retryTimer=setTimeout(()=>this.start(),delay);
  }
  async start() {
    this.stop();if(!this.settings?.enabled){this.state(this.settings?'Synchronisation en pause':'Relier le PC et l’iPhone','off');return;}
    if(!navigator.onLine){this.state('Hors connexion · votre musique reste disponible','waiting');return;}
    if(!window.RTCPeerConnection || !crypto.subtle){this.state('Synchronisation indisponible dans ce navigateur. Utilisez Safari ou un navigateur récent.','error');return;}
    const generation=this.generation,{role,code}=this.settings;
    this.state('Connexion sécurisée en cours…','waiting');
    try{
      const Peer=await loadPeer(),id=await sourceId(code);if(generation!==this.generation)return;
      // Explicit STUN-only configuration: no paid relay and no hosted audio files.
      const peer=new Peer(role==='source'?id:'sillage-phone-'+crypto.randomUUID(),{host:'0.peerjs.com',port:443,path:'/',secure:true,key:'peerjs',debug:0,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'}]}});
      this.peer=peer;
      const current=()=>generation===this.generation;
      this.connectTimer=setTimeout(()=>{if(current() && ![...this.sessions].some(s=>s.authorized))this.retry(role==='source'?'Service de liaison indisponible · nouvelle tentative automatique':'PC non joignable. Gardez Sillage ouvert sur le PC et essayez le même Wi-Fi.');},30000);
      peer.on('open',()=>{
        console.info('[Sillage sync] Liaison ouverte : '+role);
        if(!current())return;
        if(role==='source'){clearTimeout(this.connectTimer);this.state('PC prêt · en attente de l’iPhone','waiting');}
        else {try{this.bind(peer.connect(id,{reliable:true,serialization:'raw',label:'sillage-sync-v1'}),generation);}catch{this.retry('La liaison n’a pas démarré. Nouvelle tentative automatique.');}}
      });
      peer.on('connection',connection=>{
        if(!current() || role!=='source' || this.sessions.size>=3){connection.close();return;}
        this.bind(connection,generation);
      });
      peer.on('call',call=>call.close());
      peer.on('disconnected',()=>{if(current())this.retry();});
      peer.on('error',error=>{
        console.info('[Sillage sync] Liaison : '+error.type);
        if(!current())return;
        if(error.type==='unavailable-id'){this.stop();this.state('Un autre onglet utilise déjà ce PC. Gardez un seul onglet source ouvert.','error');return;}
        this.retry(role==='receiver'?'En attente du PC. Ouvrez Sillage dans le navigateur où se trouve votre musique.':'Service de liaison momentanément indisponible.');
      });
      this.pollTimer=setInterval(()=>{if(current())this.receiver?.requestSync().catch(()=>this.retry());},10000);
    }catch(error){if(generation===this.generation)this.retry(error.message);}
  }
  bind(connection,generation) {
    const {role,code}=this.settings;
    console.info('[Sillage sync] Canal demandé : '+role);
    connection.peerConnection?.addEventListener('connectionstatechange',()=>console.info('[Sillage sync] Canal : '+connection.peerConnection?.connectionState));
    const session=new SyncSession(connection,{role,code,store:this.store,
      onSaved:()=>this.store.onSaved?.(),
      onState:state=>{if(generation!==this.generation)return;this.attempts=0;clearTimeout(this.connectTimer);this.state(state.text,state.progress!==undefined?'copying':state.done?'ready':'connected',state);},
      onClose:error=>{
        if(error)console.info('[Sillage sync] Session : '+(error.kind||'protocol')+' · '+error.message);
        this.sessions.delete(session);if(generation!==this.generation)return;
        if(role==='source'){this.state(this.sessions.size?'Appareil associé connecté':'PC prêt · en attente de l’iPhone','waiting');return;}
        if(error && error.kind!=='network'){this.stop();this.state(error.message,'error');}
        else this.retry();
      }
    });
    this.sessions.add(session);if(role==='receiver')this.receiver=session;
  }
}

export async function syncPanel(manager,{modal,$,esc,toast,count,initialCode=''}) {
  const s=manager.settings;
  const explanation='<p class="modal-copy">Un profil privé pour retrouver votre PC et votre iPhone. Son ID reste le même, et l’association est mémorisée sur chaque appareil. Les morceaux se copient quand Sillage est ouvert sur les deux.</p>';
  const conditions='<p class="notice">Gardez les deux appareils allumés et Sillage ouvert pendant la copie. Le même Wi-Fi est conseillé. Après la copie, le PC peut être éteint. Sur iPhone, faites l’association depuis l’icône Sillage de l’écran d’accueil.</p>';
  const privacy='<details class="sync-details"><summary>Fonctionnement et confidentialité</summary><p>La musique passe directement et chiffrée entre vos appareils. PeerJS et un serveur STUN aident à établir la connexion et voient des informations de connexion, dont les adresses IP. Ils ne stockent pas votre musique. Le service de liaison gratuit et certains réseaux peuvent être indisponibles.</p><p>Sur des réseaux différents, notamment en 4G/5G, la liaison directe peut échouer. Revenez au même Wi-Fi. La copie n’est pas garantie quand iOS ferme ou suspend Sillage.</p><p>Les noms et le contenu des playlists suivent le PC. Les favoris de l’iPhone sont conservés. Supprimer un morceau ou une playlist sur le PC ne supprime pas sa copie sur l’iPhone. Un morceau supprimé seulement de l’iPhone sera recopié tant qu’il reste sur le PC.</p></details>';
  const status='<div class="sync-live" role="status"><strong id="sync-live-text"></strong><div class="progress"><i id="sync-progress"></i></div></div>';
  let html=explanation+status;
  if(!s || initialCode)html+=`<div class="sync-choices">${s?'<p class="notice">Utiliser un autre profil remplacera l’association de cet appareil. Les morceaux déjà copiés resteront conservés.</p>':'<label class="form-label" for="profile-name-new">Nom de votre espace</label><input class="field" id="profile-name-new" maxlength="60" placeholder="Mon espace"><button id="sync-source" class="button primary full" style="margin-top:12px">Créer mon profil sur ce PC</button>'}<p class="modal-copy">Cette bibliothèque contient ${count()} morceau${count()>1?'x':''}. Créez le profil dans le navigateur où vos titres apparaissent.</p><form id="sync-pair-form"><label class="form-label" for="sync-pair-code">Retrouver mon profil : clé privée ou lien d’association</label><input id="sync-pair-code" class="field sync-code-input" value="${esc(initialCode)}" placeholder="Collez votre lien privé ou votre clé" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" required><button class="button primary full" style="margin-top:12px">Associer cet appareil et recevoir ma musique</button><p class="modal-copy">L’ID seul n’ouvre pas le profil : la clé privée protège l’accès. Sur iPhone, faites cette étape depuis l’icône Sillage de l’écran d’accueil.</p></form></div>`;
  else {
    const id=await profileId(s.code);
    html+=`<div class="profile-card"><span class="eyebrow">MON PROFIL PRIVÉ</span><strong>${esc(profileName(s.name))}</strong><output>${esc(id)}</output><small>${s.role==='source'?'Ce PC envoie la bibliothèque':'Cet appareil reçoit la bibliothèque du PC'}</small></div><form id="profile-name-form"><label class="form-label" for="profile-name">Nom affiché sur cet appareil</label><div class="profile-name-row"><input class="field" id="profile-name" maxlength="60" value="${esc(profileName(s.name))}"><button class="button text-button">Enregistrer</button></div></form><details class="sync-details"><summary>Associer un appareil ou conserver ma clé</summary><p>Ce lien et cette clé donnent accès à votre bibliothèque et aux demandes YouTube sur votre PC. Gardez-les privés. Le QR se crée sur cet appareil ; il n’est envoyé à aucun service.</p><button id="profile-show-qr" class="button text-button full">Afficher mon QR privé</button><div id="profile-qr" class="profile-qr"></div><button id="profile-copy-link" class="button primary full">Copier mon lien d’association</button><p class="form-label">Clé privée (ancien code de synchronisation)</p><output class="sync-code">${esc(displayCode(s.code))}</output><button id="sync-copy-code" class="button text-button full">Copier la clé privée</button><p>Conservez la clé séparément. Un profil est une association privée entre appareils, sans compte ni stockage en ligne ; perdre cette clé et les données de tous les appareils empêche de retrouver cette association.</p></details>`;
  }
  if(s)html+=`<div class="form-actions"><button class="button text-button" id="sync-pause">${s.enabled?'Mettre en pause':'Reprendre'}</button><button class="button primary" id="sync-retry">Réessayer maintenant</button></div><button class="sync-forget" id="sync-forget">Dissocier ces appareils (garder la musique)</button>`;
  html+=conditions+privacy;
  if(!modal('Mon profil et mes appareils',html))return;
  const redraw=()=>syncPanel(manager,{modal,$,esc,toast,count});
  const run=async fn=>{try{await fn();redraw();}catch(error){toast(error.message);}};
  if($('#sync-source'))$('#sync-source').onclick=()=>run(()=>manager.configure('source',undefined,$('#profile-name-new').value));
  if($('#sync-pair-form'))$('#sync-pair-form').onsubmit=event=>{event.preventDefault();run(()=>manager.configure('receiver',readInvitation($('#sync-pair-code').value)));};
  if($('#profile-name-form'))$('#profile-name-form').onsubmit=event=>{event.preventDefault();run(()=>manager.rename($('#profile-name').value));};
  if($('#profile-copy-link'))$('#profile-copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(invitation(s.code));toast('Lien privé copié. Collez-le dans Mon profil sur l’autre appareil.');}catch{toast('Utilisez la clé privée affichée ci-dessous.');}};
  if($('#profile-show-qr'))$('#profile-show-qr').onclick=()=>renderProfileQR($('#profile-qr'),s.code).catch(e=>toast(e.message));
  if($('#sync-copy-code'))$('#sync-copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(displayCode(s.code));toast('Code copié. Saisissez-le dans Sillage sur l’iPhone.');}catch{toast('Sélectionnez le code ci-dessus pour le copier.');}};
  if($('#sync-pause'))$('#sync-pause').onclick=()=>run(()=>s.enabled?manager.pause():manager.resume());
  if($('#sync-retry'))$('#sync-retry').onclick=()=>run(()=>manager.resume());
  if($('#sync-forget'))$('#sync-forget').onclick=()=>run(()=>manager.forget());
  updateSyncStatus(manager,$);
}
export function updateSyncStatus(manager,$) {
  const state=manager.status;
  if($('#sync-label'))$('#sync-label').textContent='Mon profil';
  if($('#sync-status')){$('#sync-status').textContent=state.text;$('#sync-status').dataset.kind=state.kind;}
  if($('#sync-live-text'))$('#sync-live-text').textContent=state.text;
  if($('#sync-progress'))$('#sync-progress').style.width=(state.progress!==undefined?Math.round(state.progress*100):state.done?100:0)+'%';
}
