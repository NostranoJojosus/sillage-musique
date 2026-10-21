import {SyncSession, newCode, normalizeCode, displayCode, sourceId} from './sync-protocol.mjs';

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
  async configure(role,code) {
    const next={role,code:normalizeCode(code||newCode()),enabled:true};
    localStorage.setItem(SETTINGS,JSON.stringify(next));this.settings=next;this.attempts=0;await this.start();
  }
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

export function syncPanel(manager,{modal,$,esc,toast,count}) {
  const s=manager.settings;
  const explanation='<p class="modal-copy">Associez vos appareils une fois. Ensuite, les nouveaux morceaux et les playlists se copient automatiquement du PC vers l’iPhone quand Sillage est ouvert sur les deux.</p>';
  const conditions='<p class="notice">Gardez les deux appareils allumés et Sillage ouvert pendant la copie. Le même Wi-Fi est conseillé. Après la copie, le PC peut être éteint. Sur iPhone, faites l’association depuis l’icône Sillage de l’écran d’accueil.</p>';
  const privacy='<details class="sync-details"><summary>Fonctionnement et confidentialité</summary><p>La musique passe directement et chiffrée entre vos appareils. PeerJS et un serveur STUN aident à établir la connexion et voient des informations de connexion, dont les adresses IP. Ils ne stockent pas votre musique. Le service de liaison gratuit et certains réseaux peuvent être indisponibles.</p><p>Sur des réseaux différents, notamment en 4G/5G, la liaison directe peut échouer. Revenez au même Wi-Fi. La copie n’est pas garantie quand iOS ferme ou suspend Sillage.</p><p>Les noms et le contenu des playlists suivent le PC. Les favoris de l’iPhone sont conservés. Supprimer un morceau ou une playlist sur le PC ne supprime pas sa copie sur l’iPhone. Un morceau supprimé seulement de l’iPhone sera recopié tant qu’il reste sur le PC.</p></details>';
  const status='<div class="sync-live" role="status"><strong id="sync-live-text"></strong><div class="progress"><i id="sync-progress"></i></div></div>';
  let html=explanation+status;
  if(!s)html+=`<div class="sync-choices"><button id="sync-source" class="button primary full">Ce PC envoie ma musique</button><p class="modal-copy">Cette bibliothèque contient ${count()} morceau${count()>1?'x':''}. Choisissez le navigateur où vos titres apparaissent.</p><form id="sync-pair-form"><label class="form-label" for="sync-pair-code">Sur l’iPhone : code affiché sur le PC</label><input id="sync-pair-code" class="field sync-code-input" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" required><button class="button primary full" style="margin-top:12px">Associer et recevoir automatiquement</button></form></div>`;
  else if(s.role==='source')html+=`<p class="form-label">Code privé à saisir une seule fois sur l’iPhone</p><output class="sync-code">${esc(displayCode(s.code))}</output><button id="sync-copy-code" class="button text-button full">Copier le code</button><p class="modal-copy">Sur l’iPhone : <strong>Synchroniser</strong>, puis saisissez ce code. Il donne accès à cette bibliothèque ; gardez-le privé.</p>`;
  else html+='<p class="modal-copy"><strong>Cet appareil reçoit la bibliothèque du PC associé.</strong> Il récupérera les nouveaux titres dès que les deux appareils pourront se joindre.</p>';
  if(s)html+=`<div class="form-actions"><button class="button text-button" id="sync-pause">${s.enabled?'Mettre en pause':'Reprendre'}</button><button class="button primary" id="sync-retry">Réessayer maintenant</button></div><button class="sync-forget" id="sync-forget">Dissocier ces appareils (garder la musique)</button>`;
  html+=conditions+privacy;
  if(!modal('Synchroniser mes appareils',html))return;
  const redraw=()=>syncPanel(manager,{modal,$,esc,toast,count});
  const run=async fn=>{try{await fn();redraw();}catch(error){toast(error.message);}};
  if($('#sync-source'))$('#sync-source').onclick=()=>run(()=>manager.configure('source'));
  if($('#sync-pair-form'))$('#sync-pair-form').onsubmit=event=>{event.preventDefault();run(()=>manager.configure('receiver',$('#sync-pair-code').value));};
  if($('#sync-copy-code'))$('#sync-copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(displayCode(s.code));toast('Code copié. Saisissez-le dans Sillage sur l’iPhone.');}catch{toast('Sélectionnez le code ci-dessus pour le copier.');}};
  if($('#sync-pause'))$('#sync-pause').onclick=()=>run(()=>s.enabled?manager.pause():manager.resume());
  if($('#sync-retry'))$('#sync-retry').onclick=()=>run(()=>manager.resume());
  if($('#sync-forget'))$('#sync-forget').onclick=()=>run(()=>manager.forget());
  updateSyncStatus(manager,$);
}
export function updateSyncStatus(manager,$) {
  const state=manager.status;
  if($('#sync-label'))$('#sync-label').textContent=state.kind==='copying'?'Copie en cours':state.kind==='ready'?'À jour':'Synchroniser';
  if($('#sync-status')){$('#sync-status').textContent=state.text;$('#sync-status').dataset.kind=state.kind;}
  if($('#sync-live-text'))$('#sync-live-text').textContent=state.text;
  if($('#sync-progress'))$('#sync-progress').style.width=(state.progress!==undefined?Math.round(state.progress*100):state.done?100:0)+'%';
}
