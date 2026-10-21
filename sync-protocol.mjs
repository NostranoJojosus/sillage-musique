import {contentId, validateManifest, MAX_HEADER, MAX_TRACK} from './format.mjs';
import {validateSpotifyLinks} from './spotify-links.mjs';

export const CHUNK = 16000;
export const WINDOW = 8;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const newCode = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export function normalizeCode(value) {
  const key = String(value).replace(/[\s-]/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(key)) throw Error('Recopiez les 8 groupes de 4 caractères affichés sur le PC.');
  return key;
}
export const displayCode = key => normalizeCode(key).toUpperCase().match(/.{4}/g).join('-');
export async function sourceId(key) {
  return 'sillage-' + hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('sillage-source-v1:' + normalizeCode(key)))));
}
async function authKey(code) {
  return crypto.subtle.importKey('raw', Uint8Array.from(normalizeCode(code).match(/../g), x => parseInt(x, 16)), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
}
export async function proof(code, role, server, client) {
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', await authKey(code), encoder.encode(`sillage-v1|${role}|${server}|${client}`))));
}
export async function verifyProof(code, role, server, client, value) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) return false;
  return crypto.subtle.verify('HMAC', await authKey(code), Uint8Array.from(value.match(/../g), x => parseInt(x, 16)), encoder.encode(`sillage-v1|${role}|${server}|${client}`));
}
export function catalogOf(library) {
  const catalog = {version:1, tracks:library.tracks.map(t => ({id:t.id,title:t.title,artist:t.artist,type:t.type,size:t.size,duration:t.duration,favorite:!!t.favorite})), playlists:library.playlists.map(p => ({id:p.id,name:p.name,trackIds:[...p.trackIds]})),spotify:validateSpotifyLinks(library.spotify||[])};
  return validateCatalog(catalog);
}
export function validateCatalog(catalog) {
  if (JSON.stringify(catalog).length > MAX_HEADER) throw Error('La liste de morceaux est trop volumineuse.');
  const size = catalog?.tracks?.reduce((sum, t) => sum + (t?.size || 0), 0);
  validateManifest(catalog, size, Number.MAX_SAFE_INTEGER);
  if(catalog.spotify!==undefined)validateSpotifyLinks(catalog.spotify);
  return catalog;
}
export function mergeMetadata(local, catalog) {
  const byId = new Map(local.tracks.map(t => [t.id,t]));
  return {tracks:catalog.tracks.map(t => {
    const previous = byId.get(t.id);
    if (!previous) throw Error('Un morceau doit être reçu avant sa playlist.');
    return {...previous, title:t.title,artist:t.artist,duration:t.duration};
  }), playlists:catalog.playlists.map(p => ({...p,trackIds:[...p.trackIds]}))};
}
export class SyncFault extends Error {
  constructor(message, kind='protocol') { super(message); this.kind=kind; }
}

// Independent of PeerJS and the UI: the same protocol is exercised by the tests.
// Nothing from the library is sent before both peers prove possession of the code.
export class SyncSession {
  constructor(connection, {role,code,store,onState=()=>{},onSaved=()=>{},onClose=()=>{},idleMs=90000}) {
    this.conn=connection;this.role=role;this.code=normalizeCode(code);this.store=store;
    this.onState=onState;this.onSaved=onSaved;this.onClose=onClose;
    this.stage='opening';this.closed=false;this.active=false;this.chain=Promise.resolve();this.last=Date.now();this.idleMs=idleMs;this.requests=new Map();
    connection.on('open',()=>this.guard(()=>this.open()));
    connection.on('data',data=>this.guard(()=>this.message(data)));
    connection.on('close',()=>this.close());
    connection.on('error',()=>this.close(new SyncFault('Connexion interrompue. Les morceaux terminés sont conservés.','network')));
    this.timer=setInterval(()=>{if(Date.now()-this.last>(this.authorized?idleMs:25000))this.close(new SyncFault('L’autre appareil ne répond plus.','network'));},1000);
    this.timer.unref?.();
  }
  guard(fn) {
    this.chain=this.chain.then(async()=>{if(!this.closed)await fn();}).catch(error=>{
      if(this.closed)return;
      this.close(error?.name==='QuotaExceededError'?new SyncFault('L’iPhone manque de place. Libérez du stockage puis réessayez.','storage'):error);
    });
  }
  state(text,extra={}) { if(!this.closed)this.onState({text,...extra}); }
  send(value) {
    if(this.closed || !this.conn.open)throw new SyncFault('Connexion interrompue.','network');
    const json=JSON.stringify(value);
    if(json.length>MAX_HEADER+100)throw new SyncFault('Liste de morceaux trop volumineuse.');
    if(json.length<=4000){this.conn.send(json);return;}
    const n=Math.ceil(json.length/4000);
    for(let i=0;i<n;i++)this.conn.send(JSON.stringify({t:'part',i,n,data:json.slice(i*4000,(i+1)*4000)}));
  }
  async open() {
    this.last=Date.now();
    if(this.role==='source'){this.serverNonce=newCode();this.stage='auth';this.send({t:'challenge',nonce:this.serverNonce,features:this.store.rpc?['youtube-v1']:[]});}
    else this.stage='challenge';
  }
  async message(data) {
    this.last=Date.now();
    if(typeof data!=='string'){
      if(data instanceof Blob)data=await data.arrayBuffer();
      if(!this.authorized || this.role!=='receiver' || !(data instanceof ArrayBuffer))throw new SyncFault('Données de synchronisation inattendues.');
      return this.chunk(data);
    }
    if(data.length>MAX_HEADER+200)throw new SyncFault('Message de synchronisation trop volumineux.');
    let m;try{m=JSON.parse(data);}catch{throw new SyncFault('Message de synchronisation illisible.');}
    if(!m || typeof m!=='object')throw new SyncFault('Message invalide.');
    if(m.t==='part'){
      if(!this.authorized || typeof m.data!=='string' || m.data.length>4000 || !Number.isSafeInteger(m.n) || m.n<1 || m.n>Math.ceil((MAX_HEADER+100)/4000) || !Number.isSafeInteger(m.i))throw new SyncFault('Fragment de liste invalide.');
      if(!this.parts)this.parts={next:0,n:m.n,text:''};
      if(m.i!==this.parts.next || m.n!==this.parts.n || this.parts.text.length+m.data.length>MAX_HEADER+100)throw new SyncFault('Liste de morceaux incomplète.');
      this.parts.text+=m.data;this.parts.next++;
      if(this.parts.next===m.n){const complete=this.parts.text;this.parts=null;return this.message(complete);}
      return;
    }
    if(this.parts)throw new SyncFault('Liste de morceaux interrompue.');
    if(!this.authorized)return this.authenticate(m);
    if(m.t==='rpc' && this.role==='source') {
      if(!/^[a-f0-9]{32}$/.test(m.id) || m.method!=='youtube' || !m.params || JSON.stringify(m.params).length>3000)throw new SyncFault('Demande distante invalide.');
      let reply;
      try{if(!this.store.rpc)throw Error('Mettez à jour Sillage sur le PC.');reply={t:'rpc-result',id:m.id,result:await this.store.rpc(m.method,m.params)};}
      catch(error){reply={t:'rpc-result',id:m.id,error:String(error.message||'Demande impossible.').slice(0,1600),kind:error.kind==='network'?'network':'request'};}
      if(!this.closed)this.send(reply);return;
    }
    if(m.t==='rpc-result' && this.role==='receiver') {
      const pending=this.requests.get(m.id);if(!pending)return;
      clearTimeout(pending.timer);this.requests.delete(m.id);
      if(m.error){const e=Error(String(m.error).slice(0,1600));e.kind=m.kind==='network'?'network':'request';pending.reject(e);}else pending.resolve(m.result);return;
    }
    if(this.role==='source')return this.sourceMessage(m);
    return this.receiverMessage(m);
  }
  async authenticate(m) {
    if(this.role==='receiver' && this.stage==='challenge' && m.t==='challenge' && /^[a-f0-9]{32}$/.test(m.nonce)){
      this.serverNonce=m.nonce;this.features=Array.isArray(m.features)?m.features.filter(x=>x==='youtube-v1'):[];this.clientNonce=newCode();this.stage='proof';
      this.send({t:'auth',nonce:this.clientNonce,proof:await proof(this.code,'client',this.serverNonce,this.clientNonce)});return;
    }
    if(this.role==='source' && this.stage==='auth' && m.t==='auth' && /^[a-f0-9]{32}$/.test(m.nonce) && await verifyProof(this.code,'client',this.serverNonce,m.nonce,m.proof)){
      this.clientNonce=m.nonce;this.authorized=true;this.stage='ready';
      this.send({t:'authorized',proof:await proof(this.code,'server',this.serverNonce,this.clientNonce)});this.state('Appareil associé connecté');return;
    }
    if(this.role==='receiver' && this.stage==='proof' && m.t==='authorized' && await verifyProof(this.code,'server',this.serverNonce,this.clientNonce,m.proof)){
      this.authorized=true;this.stage='ready';this.state('PC connecté');await this.requestSync();return;
    }
    throw new SyncFault('Le code ne correspond pas. Vérifiez-le sur le PC.','auth');
  }
  async requestSync() {
    if(this.closed || !this.authorized || this.role!=='receiver' || this.active)return;
    this.active=true;this.send({t:'catalog-request'});
  }
  request(method,params,timeout=15000) {
    if(this.closed || !this.authorized || this.role!=='receiver')return Promise.reject(new SyncFault('Le PC n’est pas connecté.','network'));
    if(method!=='youtube' || !this.features?.includes('youtube-v1'))return Promise.reject(Error('Mettez à jour Sillage sur le PC pour utiliser YouTube.'));
    if(this.requests.size>=4)return Promise.reject(Error('Une demande est déjà en cours.'));
    const id=newCode();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.requests.delete(id);reject(new SyncFault('Le PC ne répond pas. La demande sera reprise.','network'));},timeout);timer.unref?.();
      this.requests.set(id,{resolve,reject,timer});
      try{this.send({t:'rpc',id,method,params});}catch(e){clearTimeout(timer);this.requests.delete(id);reject(e);}
    });
  }
  async sourceMessage(m) {
    if(m.t==='catalog-request' && !this.sending){
      this.catalog=catalogOf(await this.store.getLibrary());this.send({t:'catalog',catalog:this.catalog});return;
    }
    if(m.t==='want' && !this.sending && this.catalog){
      const track=this.catalog.tracks.find(t=>t.id===m.id);
      if(!track)throw new SyncFault('Morceau demandé hors de la bibliothèque.');
      const blob=await this.store.getBlob(track.id);
      if(!blob || blob.size!==track.size)throw new SyncFault('La bibliothèque du PC a changé. Nouvelle tentative dans quelques instants.','network');
      this.sending={track,blob,offset:0};this.send({t:'begin',id:track.id});this.state('Envoi : '+track.title,{progress:0});return;
    }
    if(m.t==='ack' && this.sending && m.id===this.sending.track.id && m.offset===this.sending.offset && this.sending.offset<this.sending.track.size)return this.pump();
    if(m.t==='stored' && this.sending && m.id===this.sending.track.id && this.sending.offset===this.sending.track.size){this.sending=null;return;}
    if(m.t==='complete' && !this.sending){this.state('À jour · les prochains ajouts seront envoyés',{done:true});return;}
    throw new SyncFault('Échange de synchronisation interrompu.');
  }
  async pump() {
    const transfer=this.sending;
    for(let i=0;i<WINDOW && transfer.offset<transfer.blob.size;i++){
      const bytes=await transfer.blob.slice(transfer.offset,transfer.offset+CHUNK).arrayBuffer();
      if(this.closed)return;
      const frame=new Uint8Array(4+bytes.byteLength);new DataView(frame.buffer).setUint32(0,transfer.offset);frame.set(new Uint8Array(bytes),4);
      transfer.offset+=bytes.byteLength;this.conn.send(frame.buffer);
    }
    this.state('Envoi : '+transfer.track.title,{progress:transfer.offset/transfer.blob.size});
  }
  async receiverMessage(m) {
    if(m.t==='catalog' && this.active && !this.receiving && !this.todo){
      this.catalog=validateCatalog(m.catalog);
      const local=await this.store.getLibrary(),present=new Set(local.tracks.map(t=>t.id));
      this.todo=this.catalog.tracks.filter(t=>!present.has(t.id));this.total=this.todo.length;this.completed=0;
      await this.store.checkSpace?.(this.todo.reduce((sum,t)=>sum+t.size,0));
      return this.next();
    }
    if(m.t==='begin' && this.expected && m.id===this.expected.id && !this.receiving){
      this.receiving={track:this.expected,parts:[],offset:0,frames:0};this.send({t:'ack',id:m.id,offset:0});return;
    }
    throw new SyncFault('Réponse du PC inattendue.');
  }
  async next() {
    this.expected=this.todo.shift();
    if(this.expected){this.state(`Copie ${this.completed+1}/${this.total} : ${this.expected.title}`,{progress:0});this.send({t:'want',id:this.expected.id});return;}
    await this.store.applyMetadata(this.catalog);
    await this.onSaved();
    if(this.closed)return;
    this.todo=null;this.active=false;this.send({t:'complete'});this.state('À jour · musique disponible hors connexion',{done:true});
  }
  async chunk(buffer) {
    const r=this.receiving;
    if(!r || buffer.byteLength<=4 || buffer.byteLength>CHUNK+4 || new DataView(buffer).getUint32(0)!==r.offset || r.offset+buffer.byteLength-4>r.track.size || r.track.size>MAX_TRACK)throw new SyncFault('Le transfert audio est invalide.');
    r.parts.push(buffer.slice(4));r.offset+=buffer.byteLength-4;r.frames++;
    this.state(`Copie ${this.completed+1}/${this.total} : ${r.track.title}`,{progress:r.offset/r.track.size});
    if(r.offset===r.track.size){
      const blob=new Blob(r.parts,{type:r.track.type});r.parts=[];
      if(await contentId(blob)!==r.track.id)throw new SyncFault('Le morceau reçu est endommagé. Rien de partiel n’a été enregistré.','integrity');
      if(this.closed)return;
      await this.store.commitImport([{track:{...r.track,addedAt:Date.now()},blob}],[]);
      await this.onSaved();
      if(this.closed)return;
      this.send({t:'stored',id:r.track.id});this.receiving=null;this.completed++;return this.next();
    }
    if(r.frames%WINDOW===0)this.send({t:'ack',id:r.track.id,offset:r.offset});
  }
  close(error) {
    if(this.closed)return;this.closed=true;clearInterval(this.timer);this.receiving=null;this.sending=null;this.todo=null;this.parts=null;
    for(const p of this.requests.values()){clearTimeout(p.timer);p.reject(new SyncFault('Connexion interrompue. La demande sera reprise.','network'));}this.requests.clear();
    try{this.conn.close();}catch{}
    this.onClose(error);
  }
}
