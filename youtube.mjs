import {newCode} from './sync-protocol.mjs';
import {profileId} from './profile.mjs';

export function youtubeURL(value) {
  let u;try{u=new URL(String(value).trim());}catch{throw Error('Collez le lien complet d’une vidéo YouTube.');}
  if(u.protocol!=='https:' || u.username || u.password || u.port || !['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(u.hostname))throw Error('Utilisez un lien HTTPS YouTube ou youtu.be.');
  const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):/^\/(shorts|live|embed)\//.test(u.pathname)?u.pathname.split('/')[2]:null;
  if(!/^[a-zA-Z0-9_-]{11}$/.test(id||''))throw Error('Choisissez une vidéo YouTube, pas une chaîne ou une playlist entière.');
  return 'https://www.youtube.com/watch?v='+id;
}
const KEY='sillage-youtube-v1',ID=/^[a-f0-9]{32}$/;
export function readQueue(value) {
  try{return JSON.parse(value).filter(j=>ID.test(j?.id||'') && typeof j.scope==='string' && j.scope.length<40 && youtubeURL(j.url)===j.url).slice(-50).map(j=>({...j,status:['waiting','running','copying','done','error'].includes(j.status)?j.status:'waiting'}));}catch{return [];}
}

export class YouTubeQueue extends EventTarget {
  constructor({companion,sync,importAudio,hasTrack,storage=localStorage}) {
    super();Object.assign(this,{companion,sync,importAudio,hasTrack,storage});this.items=readQueue(storage.getItem(KEY));this.importing=new Map();this.collected=new Map();
    this.timer=setInterval(()=>this.tick(),4000);this.timer.unref?.();
    companion.addEventListener('change',()=>{this.changed();this.tick();});sync.addEventListener('change',()=>this.tick());
    window.addEventListener('pagehide',()=>clearInterval(this.timer));
  }
  changed(){this.dispatchEvent(new Event('change'));}
  save(){this.storage.setItem(KEY,JSON.stringify(this.items));this.changed();}
  async scope(){return this.sync.settings?profileId(this.sync.settings.code):'local';}
  async preparePC(){
    if(this.sync.settings?.role==='receiver')return;
    await this.companion.ensureReady();
  }
  async addFromClick(value){
    const url=youtubeURL(value),connection=this.preparePC();
    // Keep the request even if its browser blocks the converter window.
    connection.catch(()=>{});
    const item=await this.add(url);
    try{await connection;}catch(error){throw Error('Lien conservé dans votre liste. '+error.message);}
    this.tick();return item;
  }
  async discoverFromClick(params){await this.preparePC();return this.call(params,await this.scope());}
  async add(value){
    const url=youtubeURL(value),scope=await this.scope();
    const existing=this.items.find(j=>j.url===url && j.scope===scope && !['error','done'].includes(j.status));
    if(existing){this.tick();return existing;}
    if(this.items.filter(j=>!['done','error'].includes(j.status)).length>=20)throw Error('La liste contient déjà 20 liens en attente.');
    const item={id:newCode(),scope,url,status:'waiting',message:'En attente du PC',created:Date.now()};
    const next=[...this.items,item].slice(-50);this.storage.setItem(KEY,JSON.stringify(next));this.items=next;this.changed();this.tick();return item;
  }
  async retry(id){const j=this.items.find(j=>j.id===id);if(!j)return;await this.add(j.url);}
  async collect(job){
    if(job.status!=='done')return job;
    if(this.collected.has(job.id))return {...job,trackId:this.collected.get(job.id)};
    if(!this.importing.has(job.id))this.importing.set(job.id,(async()=>{
      const blob=await this.companion.call('audio',{id:job.id});
      const trackId=await this.importAudio(blob,job.filename||'YouTube.mp3');this.collected.set(job.id,trackId);return {...job,trackId};
    })().finally(()=>this.importing.delete(job.id)));
    return this.importing.get(job.id);
  }
  async service(_method,params) {
    if(!this.companion.status?.ready){const e=Error('En attente du convertisseur : sur le PC, lancez Demarrer-Sillage.cmd puis activez-le dans YouTube.');e.kind='network';throw e;}
    if(params.action==='submit')return this.companion.call('submit',{requestId:params.id,url:youtubeURL(params.url)});
    if(params.action==='status' && ID.test(params.id||''))return this.collect(await this.companion.call('job',{id:params.id}));
    if(params.action==='info')return {ready:true};
    if(params.action==='spotify')return this.companion.call('spotify',{url:params.url});
    if(params.action==='search')return this.companion.call('search',{query:params.query});
    throw Error('Demande YouTube invalide.');
  }
  async call(params,scope){
    if(scope!==await this.scope() && !(scope==='local' && this.companion.status?.ready)){const e=Error('Lien en attente de son profil d’origine');e.kind='network';throw e;}
    if(this.companion.status?.ready)return this.service('youtube',params);
    if(this.sync.settings?.role==='receiver' && this.sync.receiver?.authorized)return this.sync.receiver.request('youtube',params,['spotify','search'].includes(params.action)?65000:15000);
    const e=Error(this.sync.settings?.role==='receiver'?'En attente du PC associé et de son convertisseur':'En attente de connexion au convertisseur dans ce navigateur. Cliquez sur Activer le convertisseur PC.');e.kind='network';throw e;
  }
  async tick(){
    if(this.running)return;this.running=true;
    let job;
    try{
      const scope=await this.scope();
      job=this.items.find(j=>(j.scope===scope || (j.scope==='local' && this.companion.status?.ready)) && !['done','error'].includes(j.status));
      if(!job)return;
      if(job.status==='copying' && job.trackId && this.hasTrack(job.trackId)){job.status='done';job.message='Ajouté à votre bibliothèque · disponible hors connexion';this.save();return;}
      if(!job.accepted){
        const accepted=await this.call({action:'submit',url:job.url,id:job.id},job.scope);
        if(accepted.busy){job.message='Un autre lien est en conversion · attente automatique';this.save();return;}
        if(accepted.id!==job.id)throw Error('Réponse du convertisseur invalide.');job.accepted=true;this.save();
      }
      const result=await this.call({action:'status',id:job.id},job.scope);
      if(result.status==='error')throw Error(result.message||'Conversion impossible.');
      if(result.status==='done'){
        if(!/^t-[a-f0-9]{64}$/.test(result.trackId||''))throw Error('Le MP3 n’a pas été ajouté au lecteur du PC.');
        job.trackId=result.trackId;job.filename=String(result.filename||'Morceau YouTube').slice(0,260);
        job.status=this.hasTrack(job.trackId)?'done':'copying';job.message=job.status==='done'?'Ajouté à votre bibliothèque · disponible hors connexion':'MP3 prêt sur le PC · copie vers cet appareil';
        if(job.status==='copying')await this.sync.receiver?.requestSync();
      }else {job.status='running';job.message='Téléchargement et conversion MP3 sur le PC…';}
      this.save();
    }catch(e){
      if(job){job.status=e.kind==='network' || e instanceof TypeError?'waiting':'error';job.message=e.message;try{this.save();}catch{this.changed();}}
    }finally{this.running=false;}
  }
}

export function youtubePanel(queue,{modal,$,esc,toast,profile}) {
  const local=queue.companion.status?.ready,phone=queue.sync.settings?.role==='receiver';
  if(!modal('Un lien, un morceau',`<p class="modal-copy">Collez une vidéo YouTube. Votre PC prépare le MP3 et l’ajoute au lecteur ; l’iPhone associé le reçoit ensuite par synchronisation.</p><div class="youtube-connection" id="youtube-connection"></div><form id="youtube-form"><label class="form-label" for="youtube-url">Lien YouTube</label><input class="field" type="url" id="youtube-url" placeholder="https://youtu.be/…" required autocomplete="off"><button class="button primary full" style="margin-top:12px">Convertir et ajouter à ma musique</button><p id="youtube-feedback" class="import-status" role="status"></p></form><div id="youtube-jobs" aria-live="polite"></div><details class="sync-details"><summary>Première utilisation sur ce PC</summary><p>Lancez <strong>Demarrer-Sillage.cmd</strong> dans le dossier Sillage, puis cliquez sur <strong>Activer le convertisseur PC</strong>. Gardez sa fenêtre ouverte. Les outils sont déjà installés sur votre PC ; sur une nouvelle installation, lancez d’abord Installer-outils.cmd.</p><p>Sur l’iPhone, associez le profil du PC dans <strong>Mon profil</strong>. Les liens en attente restent mémorisés ici. Gardez Sillage ouvert sur les deux appareils pendant le traitement et la copie. Un profil seul ne stocke pas les MP3 en ligne.</p></details><p class="notice">Utilisez vos vidéos ou des contenus dont le téléchargement est autorisé. Une vidéo à la fois, jusqu’à une heure et 100 Mo. Une vidéo indisponible ou un changement de YouTube peut empêcher la conversion.</p>`))return;
  $('#youtube-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button'),feedback=$('#youtube-feedback'),input=$('#youtube-url');button.disabled=true;feedback.textContent='Connexion au PC et préparation de votre demande…';try{await queue.addFromClick(input.value);input.value='';feedback.textContent='Demande enregistrée ou reprise sans doublon. Son état apparaît dans Mes liens.';}catch(e){feedback.textContent=e.message;}finally{button.disabled=false;}};
  renderYouTube(queue,{$,esc,toast,profile});
}
export function renderYouTube(queue,{$,esc,toast,profile}) {
  const box=$('#youtube-connection');if(!box)return;
  const ready=queue.companion.status?.ready,receiving=queue.sync.settings?.role==='receiver';
  box.innerHTML=ready?'<p class="import-status">Convertisseur PC prêt · ajout automatique</p>':receiving?`<p class="modal-copy">${queue.sync.receiver?.authorized?'PC associé connecté. Son convertisseur doit être activé.':'Les liens attendent la connexion au PC associé.'}</p><button id="youtube-profile" class="button text-button full">Voir mon profil et la connexion</button>`:'<p class="modal-copy">Le lecteur a besoin du convertisseur Windows pour préparer les MP3.</p><button class="button text-button full" id="youtube-connect">Activer le convertisseur PC</button><button class="button text-button full" id="youtube-profile">Sur iPhone : retrouver mon profil</button>';
  if($('#youtube-connect'))$('#youtube-connect').onclick=()=>{try{queue.companion.connect();toast('Gardez la fenêtre du convertisseur ouverte. Si elle ne charge pas, lancez Demarrer-Sillage.cmd.');}catch(e){toast(e.message);}};
  if($('#youtube-profile'))$('#youtube-profile').onclick=profile;
  $('#youtube-jobs').innerHTML=queue.items.length?'<h3>Mes liens</h3>'+queue.items.slice().reverse().slice(0,8).map(j=>`<div class="youtube-job"><strong>${esc(j.filename||j.url)}</strong><span>${esc(j.message)}</span>${j.status==='error'?`<button class="button text-button small" data-youtube-retry="${esc(j.id)}">Réessayer ce lien</button>`:''}</div>`).join(''):'';
  for(const b of document.querySelectorAll('[data-youtube-retry]'))b.onclick=()=>queue.retry(b.dataset.youtubeRetry).catch(e=>toast(e.message));
}
