import {newCode} from './sync-protocol.mjs';
export const COMPANION='http://127.0.0.1:8765';
const ID=/^[a-f0-9]{32}$/;
export function validCommand(command,args={}) {
  if(command==='status' || command==='jobs')return true;
  if(command==='job' || command==='audio')return ID.test(args.id||'');
  if(command==='submit')return ID.test(args.requestId||'') && typeof args.url==='string' && args.url.length<=2048;
  if(command==='spotify')return typeof args.url==='string' && args.url.length<=2048;
  if(command==='search')return typeof args.query==='string' && args.query.trim().length>=2 && args.query.length<=200;
  return false;
}
export async function localCall(command,args={}) {
  if(!validCommand(command,args))throw Error('Commande du convertisseur invalide.');
  const status=await fetch('./api/status',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Lancez Demarrer-Sillage.cmd sur le PC.');return r.json();});
  if(command==='status')return {available:status.available,ready:status.ready};
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
    this.monitor=setInterval(()=>{if(this.popup?.closed){this.popup=null;this.status=null;this.changed();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('La fenêtre du convertisseur a été fermée.'));}this.pending.clear();}},2000);
    window.addEventListener('pagehide',()=>clearInterval(this.monitor));
  }
  changed(){this.dispatchEvent(new Event('change'));}
  async probe(){if(!this.local)return;try{this.status=await localCall('status');}catch{this.status=null;}this.changed();}
  connect(){
    if(this.local)return this.probe();
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
    const m=e.data;if(m.type==='ready'){this.status=m.status;this.changed();return;}
    if(m.type!=='result')return;
    const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);
    if(m.error)p.reject(Error(String(m.error).slice(0,1600)));else p.resolve(m.result);
  }
  async call(command,args={}){
    if(!validCommand(command,args))throw Error('Commande du convertisseur invalide.');
    if(this.local)return localCall(command,args);
    if(!this.status?.available || !this.popup || this.popup.closed)throw Error('Lancez Demarrer-Sillage.cmd, puis cliquez sur Activer le convertisseur PC.');
    const id=newCode();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Le convertisseur ne répond pas. Vérifiez son lanceur Windows.'));},['search','spotify'].includes(command)?65000:30000);
      this.pending.set(id,{resolve,reject,timer});this.popup.postMessage({type:'request',nonce:this.nonce,id,command,args},COMPANION);
    });
  }
}
