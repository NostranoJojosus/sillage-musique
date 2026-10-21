import {SyncSession, SyncFault, newCode, normalizeCode, sourceId} from './sync-protocol.mjs';
import {profileName} from './profile.mjs';
import {HttpsSync, normalizeRelayUrl} from './https-sync.mjs';

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
  constructor(store,{companion}={}) {
    super();this.store=store;this.companion=companion;this.sessions=new Set();this.status={text:'Relier le PC et l’iPhone',kind:'off'};this.generation=0;this.attempts=0;this.linkFailures=0;
    try{const s=JSON.parse(localStorage.getItem(SETTINGS));if(s && ['source','receiver'].includes(s.role)){normalizeCode(s.code);this.settings=s;}}catch{}
    window.addEventListener('online',()=>{if(this.settings?.enabled)this.start();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible' && this.settings?.enabled){if(this.https)this.https.syncOnce().catch(()=>{});else if(this.receiver?.authorized)this.receiver.requestSync().catch(()=>this.retry());else if(!this.peer || this.peer.destroyed || this.peer.disconnected)this.start();}});
    window.addEventListener('storage',event=>{if(event.key===SETTINGS){this.stop();this.settings=null;this.state('Réglage modifié dans un autre onglet. Rechargez cette page.','off');}});
    window.addEventListener('pagehide',()=>this.stop());
    window.addEventListener('pageshow',event=>{if(event.persisted && this.settings?.enabled)this.start();});
  }
  state(text,kind='waiting',extra={}) {this.status={text,kind,...extra};this.dispatchEvent(new Event('change'));}
  save() {localStorage.setItem(SETTINGS,JSON.stringify(this.settings));}
  async configure(role,code,name,relayUrl) {
    const next={role,code:normalizeCode(code||newCode()),name:profileName(name||this.settings?.name),enabled:true};
    if(relayUrl){next.transport='https';next.relayUrl=normalizeRelayUrl(relayUrl);}
    localStorage.setItem(SETTINGS,JSON.stringify(next));this.settings=next;this.attempts=0;this.linkFailures=0;await this.start(true);
  }
  async enableHTTPSFromClick(){
    if(!this.companion)throw Error('La liaison avec le PC est indisponible.');
    // Open the local bridge during the click, before the first await.
    await this.companion.ensureReady(15000,true);
    if(!this.settings || this.settings.role!=='source')this.settings={role:'source',code:newCode(),name:profileName(),enabled:true};
    this.settings.transport='https';this.settings.enabled=true;this.save();return this.start(true);
  }
  rename(name){if(!this.settings)return;this.settings.name=profileName(name);this.save();this.state(this.status.text,this.status.kind,this.status);}
  async pause() {if(!this.settings)return;const closeTunnel=this.settings.transport==='https' && this.settings.role==='source';this.settings.enabled=false;this.save();this.stop();this.state('Synchronisation en pause','off');if(closeTunnel)try{await this.companion.call('sync-stop');}catch{throw Error('Copie automatique en pause. Pour fermer aussi le lien HTTPS, fermez le lanceur Sillage sur le PC.');}}
  resume() {if(!this.settings)return;if(this.settings.transport==='https' && this.settings.role==='source')return this.enableHTTPSFromClick();this.settings.enabled=true;this.save();this.attempts=0;this.linkFailures=0;return this.start(true);}
  async forget() {const closeTunnel=this.settings?.transport==='https' && this.settings?.role==='source';localStorage.removeItem(SETTINGS);this.stop();this.settings=null;this.state('Appareils dissociés · morceaux conservés','off');if(closeTunnel)try{await this.companion.call('sync-stop');}catch{throw Error('Profil retiré de ce navigateur. Pour fermer aussi l’ancien lien HTTPS, fermez le lanceur Sillage sur le PC.');}}
  stop() {
    ++this.generation;clearTimeout(this.retryTimer);clearTimeout(this.connectTimer);clearInterval(this.pollTimer);
    this.https?.stop();this.https=null;
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
  async start(throwError=false) {
    this.stop();if(!this.settings?.enabled){this.state(this.settings?'Synchronisation en pause':'Relier le PC et l’iPhone','off');return;}
    if(!navigator.onLine){this.state('Hors connexion · votre musique reste disponible','waiting');return;}
    const generation=this.generation,{role,code}=this.settings;
    if(this.settings.transport==='https'){
      if(role==='source'){delete this.settings.relayUrl;this.save();}
      const current=()=>generation===this.generation;
      this.https=new HttpsSync({store:this.store,companion:this.companion,
        onState:state=>{if(current())this.state(state.text,state.kind,state);},
        onUrl:url=>{if(current()){this.settings.relayUrl=url;this.save();this.dispatchEvent(new Event('change'));}}
      });
      try{await this.https.start({role,code,url:this.settings.relayUrl});}
      catch(error){if(current()){this.state(error.message,'error');if(throwError)throw error;}}
      return;
    }
    if(!window.RTCPeerConnection || !crypto.subtle){this.state('Synchronisation indisponible dans ce navigateur. Utilisez Safari ou un navigateur récent.','error');return;}
    this.state(role==='source'?'Préparation du PC…':this.linkFailures?'Nouvel essai de connexion au PC…':'Recherche de votre PC…','waiting');
    try{
      const Peer=await loadPeer(),id=await sourceId(code);if(generation!==this.generation)return;
      // Explicit STUN-only configuration: no paid relay and no hosted audio files.
      const peer=new Peer(role==='source'?id:'sillage-phone-'+crypto.randomUUID(),{host:'0.peerjs.com',port:443,path:'/',secure:true,key:'peerjs',debug:0,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'}]}});
      this.peer=peer;
      const current=()=>generation===this.generation;
      this.connectTimer=setTimeout(()=>{if(current())this.retry('Le service de liaison ne répond pas. Nouvelle tentative automatique.');},30000);
      peer.on('open',()=>{
        console.info('[Sillage sync] Liaison ouverte : '+role);
        if(!current())return;
        clearTimeout(this.connectTimer);
        if(role==='source')this.state('PC prêt · ouvrez le lien sur l’iPhone','waiting');
        else {
          this.state('Recherche de votre PC…','waiting');
          try{this.bind(peer.connect(id,{reliable:true,serialization:'raw',label:'sillage-sync-v1'}),generation);}catch{this.retry('La liaison n’a pas démarré. Nouvelle tentative automatique.');}
        }
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
    if(role==='source')this.state('iPhone détecté · ouverture de la connexion…','waiting');
    const pc=connection.peerConnection;
    const connectionState=()=>{
      if(generation!==this.generation || session.closed)return;
      console.info('[Sillage sync] Canal : '+pc?.connectionState);
      if(pc?.connectionState==='connecting' && !session.authorized)this.state(role==='source'?'iPhone détecté · ouverture de la connexion…':'PC trouvé · ouverture de la connexion…','waiting');
      if(pc?.connectionState==='failed')session.close(new SyncFault('La liaison directe est bloquée.',session.authorized?'network':'network-link'));
    };
    const session=new SyncSession(connection,{role,code,store:this.store,
      onSaved:()=>this.store.onSaved?.(),
      onState:state=>{if(generation!==this.generation)return;this.attempts=0;this.linkFailures=0;clearTimeout(this.connectTimer);this.state(state.text,state.progress!==undefined?'copying':state.done?'ready':'connected',state);},
      onClose:error=>{
        if(error)console.info('[Sillage sync] Session : '+(error.kind||'protocol')+' · '+error.message);
        pc?.removeEventListener('connectionstatechange',connectionState);
        this.sessions.delete(session);if(generation!==this.generation)return;
        if(error?.kind==='network-link'){
          const message=role==='source'?'iPhone détecté, mais la liaison directe est bloquée. Gardez cette page ouverte et essayez Safari sur l’iPhone.':'Connexion directe au PC impossible. Essayez Safari sur l’iPhone, sur le même Wi-Fi, et gardez Sillage ouvert sur le PC.';
          if(role==='source'){if(![...this.sessions].some(s=>s.authorized))this.state(message,'error');return;}
          if(++this.linkFailures>=3){this.stop();this.state(message+' Touchez Relancer la connexion pour réessayer.','error');}
          else this.retry(message+' Nouvelle tentative automatique.');
          return;
        }
        if(role==='source'){this.state(this.sessions.size?'Appareil associé connecté':'PC prêt · ouvrez le lien sur l’iPhone','waiting');return;}
        if(error && error.kind!=='network'){this.stop();this.state(error.message,'error');}
        else this.retry();
      }
    });
    this.sessions.add(session);if(role==='receiver')this.receiver=session;
    pc?.addEventListener('connectionstatechange',connectionState);connectionState();
  }
}

export {syncPanel,updateSyncStatus} from './sync-panel.mjs';
