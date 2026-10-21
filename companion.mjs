import {newCode} from './sync-protocol.mjs';
export const COMPANION='http://127.0.0.1:8765';
export const AUTO_COMPANION='sillage-companion-auto-v1';
const ID=/^[a-f0-9]{32}$/;
const unavailable=message=>Object.assign(Error(message),{kind:'network'});
const requestLocal=(url,options)=>fetch(url,options).catch(()=>{throw unavailable('Le lanceur Windows ne répond pas. Relancez Demarrer-Sillage.cmd.');});
export function validCommand(command,args={}) {
  if(command==='sync-status' || command==='sync-stop')return true;
  if(command==='sync-prepare')return /^[a-f0-9]{64}$/.test(args.accessToken||'');
  if(command==='sync-put')return ID.test(args.session||'') && typeof args.data==='string' && args.data.length<=5600000 && /^[A-Za-z0-9+/]*={0,2}$/.test(args.data) && (args.kind==='catalog' && args.id==='' && args.index===0 || args.kind==='audio' && /^t-[a-f0-9]{64}$/.test(args.id||'') && Number.isInteger(args.index) && args.index>=0 && args.index<400 && args.data.length<=350000);
  if(command==='status' || command==='jobs')return true;
  if(command==='job' || command==='audio')return ID.test(args.id||'');
  if(command==='submit')return ID.test(args.requestId||'') && typeof args.url==='string' && args.url.length<=2048;
  if(command==='spotify')return typeof args.url==='string' && args.url.length<=2048;
  if(command==='search')return typeof args.query==='string' && args.query.trim().length>=2 && args.query.length<=200;
  return false;
}
export async function localCall(command,args={}) {
  if(!validCommand(command,args))throw Error('Commande du convertisseur invalide.');
  const status=await requestLocal('./api/status',{cache:'no-store'}).then(r=>{if(!r.ok)throw unavailable('Lancez Demarrer-Sillage.cmd sur le PC.');return r.json();});
  if(command==='status')return {available:status.available,ready:status.ready,httpsSync:status.httpsSync};
  if(command.startsWith('sync-')){
    const response=await requestLocal('./api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Sillage-Token':status.token},body:JSON.stringify({action:command.slice(5),...args})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'La synchronisation PC ne répond pas.');return data;
  }
  const discover=['spotify','search'].includes(command);
  let url=discover?'./api/discover':command==='jobs'?'./api/jobs':command==='submit'?'./api/youtube':`./api/${command==='audio'?'audio':'jobs'}/${args.id}`;
  const response=await fetch(url,command==='submit'||discover?{method:'POST',headers:{'Content-Type':'application/json','X-Sillage-Token':status.token},body:JSON.stringify(discover?{kind:command,...args}:{url:args.url,requestId:args.requestId})}:{cache:'no-store'});
  if(command==='audio' && response.ok){const blob=await response.blob();if(blob.size>100*1024*1024)throw Error('Morceau trop volumineux.');return blob;}
  const data=await response.json();if(!response.ok && !data.busy)throw Error(data.error||'Le convertisseur ne répond pas.');return data;
}

export class Companion extends EventTarget {
  constructor(){
    super();this.local=['127.0.0.1','localhost'].includes(location.hostname);this.pending=new Map();this.status=null;
    window.addEventListener('message',e=>this.message(e));
    this.monitor=setInterval(()=>{if(this.popup?.closed){this.popup=null;this.status=null;this.changed();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(unavailable('La fenêtre du convertisseur a été fermée.'));}this.pending.clear();}},2000);
    window.addEventListener('pagehide',()=>{clearInterval(this.monitor);this.stopAutomatic();});
  }
  changed(){this.dispatchEvent(new Event('change'));}
  startAutomatic(){
    if(this.local)return this.probe();
    try{localStorage.setItem(AUTO_COMPANION,'true');}catch{}
    if(this.autoEnabled)return;
    this.autoEnabled=true;this.autoBlocked=false;
    this.mountAutomaticFrame();
    this.autoMonitor=setInterval(()=>{
      if(!this.autoEnabled || this.autoBlocked || this.autoPermission?.state==='prompt')return;
      if(this.status && Date.now()-this.lastReady>20000){this.status=null;this.changed();}
      // A failed initial navigation has no script to reconnect it. Retry slowly.
      if(!this.status && Date.now()-this.lastFrame>30000)this.mountAutomaticFrame();
    },5000);
    this.autoMonitor.unref?.();
    this.observeLoopbackPermission();
  }
  async observeLoopbackPermission(){
    try{
      const permission=await navigator.permissions.query({name:'loopback-network'});
      if(!this.autoEnabled)return;
      const changed=()=>{
        if(!this.autoEnabled)return;
        const wasBlocked=this.autoBlocked;this.autoBlocked=permission.state==='denied';
        if(this.autoBlocked){this.clearAutomaticFrame();this.status=null;this.changed();}
        else if(wasBlocked || permission.state==='granted')this.mountAutomaticFrame();
      };
      this.autoPermission=permission;permission.addEventListener('change',changed);this.autoPermissionChange=changed;changed();
    }catch{/* Older browsers do not expose this optional permission query. */}
  }
  mountAutomaticFrame(){
    if(!this.autoEnabled || this.autoBlocked)return;
    this.clearAutomaticFrame();
    this.nonce=newCode();this.lastFrame=Date.now();this.lastReady=0;this.status=null;
    const frame=document.createElement('iframe');frame.hidden=true;frame.title='Connexion locale Sillage';
    frame.referrerPolicy='no-referrer';
    frame.src=COMPANION+'/bridge.html#'+this.nonce;
    this.frame=frame;document.body.append(frame);this.popup=frame.contentWindow;this.changed();
  }
  clearAutomaticFrame(){
    const old=this.frame;this.frame=null;
    if(old){if(this.popup===old.contentWindow)this.popup=null;old.remove();}
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(unavailable('Reconnexion au programme Sillage du PC…'));}
    this.pending.clear();
  }
  stopAutomatic(){
    this.autoEnabled=false;clearInterval(this.autoMonitor);
    if(this.autoPermissionChange)this.autoPermission?.removeEventListener('change',this.autoPermissionChange);
    this.autoPermission=this.autoPermissionChange=null;this.clearAutomaticFrame();
  }
  async probe(){if(!this.local)return;try{this.status=await localCall('status');}catch{this.status=null;}this.changed();}
  async ensureReady(timeoutMs=15000,syncOnly=false){
    const ready=()=>syncOnly?this.status?.available && this.status?.httpsSync:this.status?.ready;
    if(this.local){await this.probe();if(ready())return;throw Error('Lancez la nouvelle version de Demarrer-Sillage.cmd sur ce PC.');}
    if(ready() && this.popup && !this.popup.closed)return;
    // Called directly by a user click, before any await, so browsers allow the window.
    this.connect();
    if(ready())return;
    return new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);this.removeEventListener('change',check);error?reject(error):resolve();};
      const check=()=>{if(ready())finish();else if(!this.popup || this.popup.closed)finish(Error('Gardez la fenêtre du convertisseur ouverte.'));};
      const timer=setTimeout(()=>finish(Error('Connexion au PC non établie. Lancez Demarrer-Sillage.cmd puis autorisez la fenêtre du convertisseur pour ce site dans ce navigateur.')),timeoutMs);
      this.addEventListener('change',check);check();
    });
  }
  connect(){
    if(this.local)return this.probe();
    if(this.frame){
      if(this.status?.available)return;
      // A deliberate click can still use the existing popup as a fallback.
      this.stopAutomatic();
    }
    if(this.popup && !this.popup.closed){
      if(!this.status)this.popup.location=COMPANION+'/bridge.html#'+this.nonce;
      this.popup.focus();return;
    }
    this.nonce=newCode();const bridgeUrl=COMPANION+'/bridge.html#'+this.nonce;
    this.popup=window.open(bridgeUrl,'sillage-convertisseur-'+this.nonce,'popup,width=540,height=450');
    if(!this.popup)throw Error('Autorisez l’ouverture de la fenêtre du convertisseur, puis réessayez.');
    this.status=null;this.changed();
    // A pre-1.2 local worker may serve its old app shell on the first visit.
    // That visit updates the worker; retry once without clearing local music.
    const popup=this.popup,nonce=this.nonce;
    setTimeout(()=>{if(this.popup===popup && this.nonce===nonce && !popup.closed && !this.status){try{popup.location=bridgeUrl;}catch{/* The button allows a manual retry. */}}},6000);
  }
  message(e){
    if(e.source!==this.popup || e.origin!==COMPANION || e.data?.nonce!==this.nonce)return;
    const m=e.data;if(m.type==='ready'){this.status=m.status;this.lastReady=Date.now();this.changed();return;}
    if(m.type!=='result')return;
    const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);
    if(m.error)p.reject(m.errorKind==='network'?unavailable(String(m.error).slice(0,1600)):Error(String(m.error).slice(0,1600)));else p.resolve(m.result);
  }
  async call(command,args={}){
    if(!validCommand(command,args))throw Error('Commande du convertisseur invalide.');
    if(this.local)return localCall(command,args);
    if(!this.status?.available || !this.popup || this.popup.closed)throw unavailable(this.autoEnabled?(this.autoBlocked?'Brave refuse la connexion locale à Sillage. Autorisez l’accès à cet ordinateur pour ce site.':'Connexion automatique au programme du PC… Si Brave demande l’accès à cet ordinateur, autorisez-le pour Sillage.'):command.startsWith('sync-')?'Lancez Demarrer-Sillage.cmd, puis touchez Préparer / relancer le lien HTTPS dans Mes appareils.':'Lancez Demarrer-Sillage.cmd, puis cliquez sur Activer le convertisseur PC.');
    const id=newCode();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(unavailable('Le convertisseur ne répond pas. Vérifiez son lanceur Windows.'));},['search','spotify'].includes(command)?65000:30000);
      this.pending.set(id,{resolve,reject,timer});this.popup.postMessage({type:'request',nonce:this.nonce,id,command,args},COMPANION);
    });
  }
}
