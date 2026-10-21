import * as db from './db.mjs';
import {MAX_TRACK,bytesLabel,timeLabel,typeForName,contentId,encodePack,decodePack} from './format.mjs';
import {Player} from './player.mjs';
import {SyncManager,syncPanel,updateSyncStatus} from './sync.mjs';
import {mergeMetadata} from './sync-protocol.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
let library={tracks:[],playlists:[]},view='library',busy=false,pc=null,offlineReady=false;
const player=new Player($('#audio'));
const sync=new SyncManager({
  getLibrary:db.getLibrary,getBlob:db.getBlob,commitImport:db.commitImport,checkSpace,
  applyMetadata:async catalog=>{
    const local=await db.getLibrary(),merged=mergeMetadata(local,catalog);
    const tracks=merged.tracks.filter(t=>JSON.stringify(t)!==JSON.stringify(local.tracks.find(x=>x.id===t.id)));
    const playlists=merged.playlists.filter(p=>JSON.stringify(p)!==JSON.stringify(local.playlists.find(x=>x.id===p.id)));
    if(tracks.length||playlists.length)await db.commitMetadata(tracks,playlists);
  },
  onSaved:async()=>{await refresh();player.metadata();}
});
sync.addEventListener('change',()=>updateSyncStatus(sync,$));
function syncDialog(){syncPanel(sync,{modal,$,esc,toast,count:()=>library.tracks.length});}
$('#open-sync').onclick=syncDialog;
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),5500);}
function error(e){console.error(e);toast(e?.name==='QuotaExceededError'?'Espace insuffisant. Libérez du stockage, puis réessayez.':e.message||'Une erreur est survenue.');}
function modal(title,html){if(busy)return false;$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();return true;}
function closeModal(){if(!busy)$('#modal').close();}
$('#close-modal').onclick=closeModal;
$('#modal').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
function lock(value){busy=value;$('#close-modal').disabled=value;}
function coverColor(id){const palette=['#3c4c32','#443e57','#4e4931','#345059','#593d3b','#364643'];return palette[parseInt(id.slice(-4),16)%palette.length||0];}
const currentPlaylist=()=>library.playlists.find(p=>p.id===view);
function visibleTracks(){let all=library.tracks;if(view==='favorites')all=all.filter(t=>t.favorite);else if(currentPlaylist()){const ids=currentPlaylist().trackIds;all=ids.map(id=>library.tracks.find(t=>t.id===id)).filter(Boolean);}const q=$('#search').value.trim().toLocaleLowerCase('fr');return all.filter(t=>`${t.title} ${t.artist}`.toLocaleLowerCase('fr').includes(q));}
function setView(id){view=id;$('#search').value='';render();window.scrollTo({top:0,behavior:'smooth'});}
async function refresh(){library=await db.getLibrary();library.tracks.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));player.setTracks(library.tracks);render();}
function render(){
  if(!['library','favorites'].includes(view)&&!currentPlaylist())view='library';
  const list=visibleTracks(),name=view==='library'?'Bibliothèque':view==='favorites'?'Favoris':currentPlaylist().name;
  $('#crumb').textContent=name;$('#collection-title').innerHTML=`${esc(name)} <span>${list.length}</span>`;
  $('#collection-kicker').textContent=view==='library'?'VOTRE COLLECTION':view==='favorites'?'À ÉCOUTER EN BOUCLE':'VOTRE PLAYLIST';
  $('#collection-meta').textContent=list.length?`${list.length} morceau${list.length>1?'x':''} · ${bytesLabel(list.reduce((s,t)=>s+t.size,0))} sur cet appareil`:view==='library'?'Votre prochain morceau préféré commence ici.':'Ajoutez les morceaux qui vous ressemblent.';
  $('#side-storage').textContent=bytesLabel(library.tracks.reduce((s,t)=>s+t.size,0));
  $('#hero').classList.toggle('hidden',view!=='library');$('#playlist-options').classList.toggle('hidden',!currentPlaylist());
  $('#play-all').disabled=!list.length;
  $('#playlist-nav').innerHTML=library.playlists.map(p=>`<button class="nav-button ${view===p.id?'active':''}" data-view="${esc(p.id)}">${icon('list')}<span class="playlist-nav-label">${esc(p.name)}</span></button>`).join('');
  $('#side-empty').classList.toggle('hidden',!!library.playlists.length);
  $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.onclick=()=>setView(b.dataset.view);});
  $('#empty').classList.toggle('hidden',library.tracks.length>0 || view!=='library');
  $('#tracks').innerHTML=list.map(t=>`<div class="track-row ${player.current?.id===t.id?'playing':''}" data-track="${t.id}"><button class="track-play" aria-label="Écouter ${esc(t.title)}"><span class="track-cover" style="--cover:${coverColor(t.id)}">${icon(player.current?.id===t.id&&!player.audio.paused?'pause':'play')}</span><span class="track-info"><strong>${esc(t.title)}</strong><small>${esc(t.artist||'Bibliothèque personnelle')} · sur cet appareil</small></span></button><span class="track-duration">${timeLabel(t.duration)}</span><button class="icon-button favorite ${t.favorite?'on':''}" aria-label="${t.favorite?'Retirer des favoris':'Ajouter aux favoris'} : ${esc(t.title)}" aria-pressed="${!!t.favorite}">${icon('heart')}</button><button class="icon-button track-options" aria-label="Options de ${esc(t.title)}">${icon('more')}</button></div>`).join('');
  if(!list.length && (library.tracks.length||view!=='library'))$('#tracks').innerHTML=`<div class="empty-search">${$('#search').value?'Aucun morceau ne correspond à votre recherche.':view==='favorites'?'Touchez le cœur d’un morceau pour le retrouver ici.':'Cette playlist attend ses premiers morceaux.'}</div>`;
  $$('.track-row').forEach(row=>{const t=library.tracks.find(x=>x.id===row.dataset.track);row.querySelector('.track-play').onclick=()=>{if(player.current?.id===t.id)player.toggle();else player.playList(list.map(x=>x.id),list.findIndex(x=>x.id===t.id));};row.querySelector('.favorite').onclick=async()=>{try{await db.saveTrack({...t,favorite:!t.favorite});await refresh();}catch(e){error(e);}};row.querySelector('.track-options').onclick=()=>trackOptions(t);});
  updatePlayer();
}
function updatePlayer(){
  const t=player.current,playing=t&&!player.audio.paused;
  $('#now-title').textContent=t?.title||'À vous de choisir';$('#now-artist').textContent=t?(t.artist||'Bibliothèque personnelle'):'La bande-son commence ici.';
  $('#now-cover').style.background=t?coverColor(t.id):'';
  $('#toggle-play').innerHTML=icon(playing?'pause':'play');$('#toggle-play').setAttribute('aria-label',playing?'Mettre en pause':'Lire');
  $('#current-time').textContent=timeLabel(player.audio.currentTime);$('#duration').textContent=timeLabel(player.audio.duration||t?.duration||0);
  if(document.activeElement!==$('#seek'))$('#seek').value=Number.isFinite(player.audio.duration)?player.audio.currentTime/player.audio.duration*100:0;
  $('#seek').disabled=!t||!Number.isFinite(player.audio.duration);
  $('#shuffle').setAttribute('aria-pressed',String(player.shuffle));$('#repeat').setAttribute('aria-pressed',String(player.mode!=='off'));
  $('#repeat').setAttribute('aria-label',`Répétition ${player.mode==='off'?'désactivée':player.mode==='one'?'du morceau':'de la file'}`);
  $$('.track-row').forEach(row=>{const active=row.dataset.track===t?.id;row.classList.toggle('playing',active);row.querySelector('.track-cover').innerHTML=icon(active&&playing?'pause':'play');});
}
player.addEventListener('change',updatePlayer);player.addEventListener('playererror',e=>toast(e.detail));
$('#toggle-play').onclick=()=>{if(!player.current&&visibleTracks().length)player.playList(visibleTracks().map(t=>t.id));else player.toggle();};
$('#play-all').onclick=()=>player.playList(visibleTracks().map(t=>t.id));
$('#next').onclick=()=>player.next();$('#previous').onclick=()=>player.previous();
$('#shuffle').onclick=()=>{player.shuffle=!player.shuffle;updatePlayer();};
$('#repeat').onclick=()=>{player.mode={off:'all',all:'one',one:'off'}[player.mode];updatePlayer();toast(player.mode==='off'?'Répétition désactivée':player.mode==='all'?'Répéter la file d’attente':'Répéter ce morceau');};
$('#seek').oninput=e=>{if(Number.isFinite(player.audio.duration))player.audio.currentTime=+e.target.value/100*player.audio.duration;};
$('#search').oninput=render;
function playlistForm(existing){
  if(!modal(existing?'Renommer la playlist':'Une nouvelle playlist',`<form id="playlist-form"><label class="form-label" for="playlist-name">Nom de la playlist</label><input class="field" id="playlist-name" maxlength="80" placeholder="Ex. Sur la route" value="${esc(existing?.name||'')}" required autocomplete="off"><div class="form-actions"><button class="button primary" type="submit">${existing?'Enregistrer':'Créer la playlist'}</button></div></form>`))return;
  $('#playlist-form').onsubmit=async e=>{e.preventDefault();const name=$('#playlist-name').value.trim();if(!name)return;try{const p=existing?{...existing,name}:{id:'p-'+crypto.randomUUID(),name,trackIds:[]};await db.savePlaylist(p);await refresh();closeModal();setView(p.id);toast(existing?'Playlist renommée.':'Playlist créée. Ajoutez-y vos morceaux.');}catch(e){error(e);}};
  $('#playlist-name').focus();
}
$('#new-playlist').onclick=()=>playlistForm();
function playlistList(){
  if(!modal('Vos playlists',`<div class="modal-menu">${library.playlists.map(p=>`<button class="menu-button" data-playlist="${esc(p.id)}">${icon('list')}${esc(p.name)}<small>${p.trackIds.length} titres</small></button>`).join('')}<button id="create-playlist-mobile" class="button primary full">${icon('plus')}Créer une playlist</button></div>`))return;
  $$('[data-playlist]').forEach(b=>b.onclick=()=>{closeModal();setView(b.dataset.playlist);});$('#create-playlist-mobile').onclick=()=>playlistForm();
}
$('#mobile-playlists').onclick=playlistList;
function trackOptions(t){
  if(!modal(t.title,`<div class="modal-menu"><button class="menu-button" id="add-to-playlist">${icon('plus')}Ajouter à une playlist</button><button class="menu-button" id="edit-track">Modifier le titre et l’artiste</button>${currentPlaylist()?'<button class="menu-button" id="remove-from-playlist">Retirer de cette playlist</button>':''}<button class="menu-button danger" id="delete-track">Supprimer de cet appareil</button></div><p class="modal-copy">${bytesLabel(t.size)} · ${timeLabel(t.duration)} · fichier local</p>`))return;
  $('#add-to-playlist').onclick=()=>{
    if(!library.playlists.length){toast('Créez une playlist, puis ajoutez-y ce morceau.');playlistForm();return;}
    modal('Ajouter à une playlist',`<div class="modal-menu">${library.playlists.map(p=>`<button class="menu-button" data-add="${esc(p.id)}">${icon('list')}${esc(p.name)}${p.trackIds.includes(t.id)?'<small>Déjà ajouté</small>':''}</button>`).join('')}</div>`);
    $$('[data-add]').forEach(b=>b.onclick=async()=>{const p=library.playlists.find(x=>x.id===b.dataset.add);try{await db.savePlaylist({...p,trackIds:[...new Set([...p.trackIds,t.id])]});await refresh();closeModal();toast('Morceau ajouté à la playlist.');}catch(e){error(e);}});
  };
  $('#edit-track').onclick=()=>{
    modal('Modifier le morceau',`<form id="edit-form"><label class="form-label" for="track-title">Titre</label><input class="field" id="track-title" value="${esc(t.title)}" maxlength="240" required><label class="form-label" for="track-artist">Artiste</label><input class="field" id="track-artist" value="${esc(t.artist)}" maxlength="240"><div class="form-actions"><button class="button primary">Enregistrer</button></div></form>`);
    $('#edit-form').onsubmit=async e=>{e.preventDefault();const title=$('#track-title').value.trim();if(!title)return;try{await db.saveTrack({...t,title,artist:$('#track-artist').value.trim()});await refresh();player.metadata();closeModal();}catch(e){error(e);}};
  };
  if($('#remove-from-playlist'))$('#remove-from-playlist').onclick=async()=>{try{const p=currentPlaylist();await db.savePlaylist({...p,trackIds:p.trackIds.filter(id=>id!==t.id)});await refresh();closeModal();}catch(e){error(e);}};
  $('#delete-track').onclick=()=>{
    modal('Supprimer ce morceau ?',`<p class="modal-copy">« ${esc(t.title)} » sera retiré de cet appareil et de ses playlists. Votre fichier d’origine et vos sauvegardes ne sont pas modifiés.</p><div class="form-actions"><button id="cancel-delete" class="button text-button">Annuler</button><button id="confirm-delete" class="button text-button danger">Supprimer</button></div>`);
    $('#cancel-delete').onclick=closeModal;$('#confirm-delete').onclick=async()=>{try{await db.removeTrack(t.id,library.playlists);await refresh();closeModal();toast('Morceau supprimé de cet appareil.');}catch(e){error(e);}};
  };
}
$('#playlist-options').onclick=()=>{
  const p=currentPlaylist();if(!p)return;
  if(!modal(p.name,`<div class="modal-menu"><button class="menu-button" id="rename-playlist">Renommer</button><button class="menu-button" id="add-many">Ajouter des morceaux</button><button class="menu-button" id="delete-playlist">Supprimer la playlist (garder les morceaux)</button></div>`))return;
  $('#rename-playlist').onclick=()=>playlistForm(p);
  $('#add-many').onclick=()=>{
    modal('Choisir les morceaux',`<form id="choose-tracks"><div class="modal-copy">${library.tracks.map(t=>`<label style="display:flex;align-items:center;gap:10px;margin:13px 0"><input type="checkbox" name="track" value="${t.id}" ${p.trackIds.includes(t.id)?'checked':''}>${esc(t.title)}</label>`).join('')||'Importez d’abord des morceaux dans la bibliothèque.'}</div><div class="form-actions"><button class="button primary">Enregistrer</button></div></form>`);
    $('#choose-tracks').onsubmit=async e=>{e.preventDefault();try{await db.savePlaylist({...p,trackIds:$$('#choose-tracks input:checked').map(i=>i.value)});await refresh();closeModal();}catch(e){error(e);}};
  };
  $('#delete-playlist').onclick=async()=>{try{await db.deletePlaylist(p.id);await refresh();closeModal();toast('Playlist supprimée. Les morceaux sont conservés.');}catch(e){error(e);}};
};
function progress(text,percent){const s=$('#import-status');if(s)s.textContent=text;const bar=$('#import-progress');if(bar)bar.style.width=`${Math.min(100,percent)}%`;}
async function durationOf(blob){return new Promise(resolve=>{const a=new Audio(),url=URL.createObjectURL(blob);let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);a.removeAttribute('src');a.load();URL.revokeObjectURL(url);resolve(v);};const timer=setTimeout(()=>finish(0),6000);a.preload='metadata';a.onloadedmetadata=()=>finish(Number.isFinite(a.duration)?a.duration:0);a.onerror=()=>finish(0);a.src=url;});}
async function checkSpace(bytes){if(navigator.storage?.estimate){const {quota,usage}=await navigator.storage.estimate();if(quota && bytes>quota-usage)throw new DOMException('Stockage insuffisant','QuotaExceededError');}}
async function importFiles(files){
  if(busy||!files.length)return;lock(true);let imported=0,duplicates=0;const failures=[];
  try{
    for(let i=0;i<files.length;i++){
      const f=files[i];progress(`Import ${i+1}/${files.length} : ${f.name}`,i/files.length*100);
      try{
        if(f.name.toLowerCase().endsWith('.sillage')){const n=await importPack(f);imported+=n;continue;}
        const type=typeForName(f.name);if(!type)throw Error('Format non pris en charge (MP3, M4A, WAV, AAC).');if(!f.size||f.size>MAX_TRACK)throw Error('Chaque morceau doit peser entre 1 octet et 100 Mo.');
        const id=await contentId(f);if(library.tracks.some(t=>t.id===id)){duplicates++;continue;}
        await checkSpace(f.size);const raw=f.name.replace(/\.[^.]+$/,'');const split=raw.indexOf(' - ');const track={id,title:(split>0?raw.slice(split+3):raw).slice(0,240),artist:(split>0?raw.slice(0,split):'').slice(0,240),type,size:f.size,duration:await durationOf(f),favorite:false,addedAt:Date.now()};
        await db.commitImport([{track,blob:f.slice(0,f.size,type)}],[]);library.tracks.push(track);imported++;
      }catch(e){failures.push(`${f.name} : ${e.name==='QuotaExceededError'?'espace insuffisant':e.message}`);}
    }
    await refresh();const result=`${imported} morceau${imported>1?'x':''} ajouté${imported>1?'s':''}.${duplicates?` ${duplicates} déjà présent${duplicates>1?'s':''}.`:''}`;progress(result+(failures.length?' '+failures.join(' · '):' Vous pouvez les écouter hors connexion.'),100);toast(result);if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
  }catch(e){progress(e.message,0);error(e);}finally{lock(false);}
}
async function importPack(file){
  const {manifest,entries}=await decodePack(file);const fresh=[];
  for(let i=0;i<entries.length;i++){
    const {track,blob}=entries[i];progress(`Vérification de la sauvegarde : ${i+1}/${entries.length}`,i/entries.length*85);
    if(await contentId(blob)!==track.id)throw Error(`Le morceau « ${track.title} » est endommagé. Aucun morceau de cette sauvegarde n’a été ajouté.`);
    if(!library.tracks.some(t=>t.id===track.id))fresh.push({track:{id:track.id,title:track.title,artist:track.artist,type:track.type,size:track.size,duration:track.duration,favorite:!!track.favorite,addedAt:Date.now()+i},blob});
  }
  await checkSpace(fresh.reduce((s,e)=>s+e.blob.size,0));
  const playlists=manifest.playlists.map(p=>{const existing=library.playlists.find(x=>x.id===p.id);return {id:p.id,name:p.name,trackIds:[...new Set([...(existing?.trackIds||[]),...p.trackIds])]};});
  await db.commitImport(fresh,playlists);library=await db.getLibrary();return fresh.length;
}
function importDialog(){
  if(!modal('Ajoutez votre musique',`<label class="dropzone">${icon('download')}<strong>Choisir des fichiers</strong><span>MP3, M4A, WAV, AAC ou sauvegarde .sillage</span><input id="file-input" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/aac,.mp3,.m4a,.wav,.aac,.sillage" multiple aria-label="Choisir les fichiers à importer"></label><div class="progress"><i id="import-progress"></i></div><p id="import-status" class="import-status"></p><p class="notice">Les morceaux sont copiés sur cet appareil. Sur iPhone, installez d’abord Sillage sur l’écran d’accueil, puis importez depuis cette icône. Gardez l’application ouverte pendant l’import.</p>${pc?`<div class="pc-only-panel"><h3>Depuis un lien YouTube <span class="local-badge">PC</span></h3><p class="modal-copy">Pour vos vidéos ou les contenus dont le téléchargement est autorisé. Conversion locale en MP3.</p><form id="youtube-form"><label class="form-label" for="youtube-url">Lien de la vidéo</label><input class="field" id="youtube-url" type="url" placeholder="https://www.youtube.com/watch?v=…" required><button class="button text-button full" style="margin-top:12px" ${!pc.ready?'disabled':''}>Convertir puis importer</button></form>${!pc.ready?'<p class="notice">Outils gratuits à installer une seule fois : lancez Installer-outils.cmd dans le dossier Windows fourni.</p>':''}</div>`:''}`))return;
  $('#file-input').onchange=e=>importFiles([...e.target.files]);
  if($('#youtube-form'))$('#youtube-form').onsubmit=convertYoutube;
}
for(const id of ['open-import','empty-import'])$('#'+id).onclick=importDialog;
async function convertYoutube(e){
  e.preventDefault();if(busy)return;const url=$('#youtube-url').value;lock(true);let prepared;
  try{
    progress('Récupération de l’audio sur le PC…',5);
    const r=await fetch('./api/youtube',{method:'POST',headers:{'Content-Type':'application/json','X-Sillage-Token':pc.token},body:JSON.stringify({url})});const job=await r.json();if(!r.ok)throw Error(job.error||'Import impossible.');
    let result;
    for(;;){await new Promise(resolve=>setTimeout(resolve,1600));const poll=await fetch(`./api/jobs/${job.id}`);if(!poll.ok)throw Error('Le serveur local a été arrêté.');result=await poll.json();progress(result.message||'Conversion MP3 en cours…',result.status==='done'?90:35);if(result.status==='error')throw Error(result.message);if(result.status==='done')break;}
    const audio=await fetch(`./api/audio/${job.id}`);if(!audio.ok)throw Error('Le MP3 converti est introuvable.');prepared=new File([await audio.blob()],result.filename||'Import YouTube.mp3',{type:'audio/mpeg'});
  }catch(e){progress(e.message,0);error(e);}finally{lock(false);}
  if(prepared)await importFiles([prepared]);
}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);}
function transferDialog(){
  if(!modal('Emportez votre bibliothèque',`<div class="modal-copy"><p>Un seul fichier <strong>.sillage</strong> contient vos morceaux et vos playlists. Aucun compte ni serveur musical n’est nécessaire.</p><div class="help-step"><b>01</b> Exportez la bibliothèque depuis le PC.</div><div class="help-step"><b>02</b> Transférez ce fichier vers l’app <strong>Fichiers</strong> de l’iPhone (par exemple avec l’espace gratuit de votre iCloud Drive, s’il est disponible).</div><div class="help-step"><b>03</b> Dans Sillage sur l’iPhone, touchez <strong>Importer</strong> et choisissez le fichier. Attendez la fin, puis testez en mode avion.</div><p>Les transferts sont manuels dans cette version. Réimporter une sauvegarde n’ajoute pas deux fois le même audio.</p></div><label class="form-label" for="export-scope">À exporter</label><select id="export-scope" class="field"><option value="all">Toute la bibliothèque (${library.tracks.length} titres)</option>${library.playlists.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (${p.trackIds.length} titres)</option>`).join('')}</select><div class="progress"><i id="import-progress"></i></div><p id="import-status" class="import-status"></p><div class="form-actions"><button id="export-library" class="button primary" ${!library.tracks.length?'disabled':''}>${icon('upload')}Exporter</button></div>`))return;
  $('#export-library').onclick=async()=>{
    if(busy)return;lock(true);$('#export-library').disabled=true;
    try{const scope=$('#export-scope').value,p=library.playlists.find(p=>p.id===scope),tracks=p?p.trackIds.map(id=>library.tracks.find(t=>t.id===id)).filter(Boolean):library.tracks,playlists=p?[p]:library.playlists,blobs=[];for(let i=0;i<tracks.length;i++){progress(`Préparation ${i+1}/${tracks.length}…`,i/tracks.length*95);const b=await db.getBlob(tracks[i].id);if(!b)throw Error('Un fichier audio est manquant.');blobs.push(b);}const blob=encodePack({version:1,tracks,playlists},blobs);download(blob,`Sillage-${new Date().toISOString().slice(0,10)}.sillage`);progress(`Sauvegarde préparée (${bytesLabel(blob.size)}). Conservez-la sur votre PC.`,100);}catch(e){progress(e.message,0);error(e);}finally{lock(false);$('#export-library').disabled=false;}
  };
}
$('#open-transfer').onclick=transferDialog;
async function storageDialog(){
  const used=library.tracks.reduce((s,t)=>s+t.size,0);let estimate={},persisted=false;
  try{estimate=await navigator.storage?.estimate()||{};persisted=await navigator.storage?.persisted()||false;}catch{}
  if(!modal('Le stockage, en clair',`<div class="stat-large">${bytesLabel(used)} <small>de musique sur cet appareil</small></div><div class="modal-copy"><p>${library.tracks.length} morceaux · ${library.playlists.length} playlists</p><p>Pour écouter avec le PC éteint, ces fichiers doivent rester sur l’iPhone. À 192 kbit/s, comptez environ 1,4 Mo par minute.</p>${estimate.quota?`<p>Limite annoncée par le navigateur : ${bytesLabel(estimate.quota)}. L’espace réellement disponible peut être inférieur.</p>`:''}<p>${persisted?'Le navigateur a accordé la conservation persistante.':'La conservation persistante n’est pas confirmée par le navigateur.'} Une suppression des données du site ou de l’application peut effacer la bibliothèque. Gardez une sauvegarde sur votre PC.</p></div><div class="form-actions"><button id="persist" class="button text-button">Demander la conservation</button><button id="backup" class="button primary">Sauvegarder</button></div>`))return;
  $('#persist').onclick=async()=>{try{const ok=await navigator.storage?.persist?.();toast(ok?'Conservation persistante accordée.':'Le navigateur ne l’a pas accordée. Gardez une sauvegarde.');}catch(e){error(e);}};
  $('#backup').onclick=transferDialog;
}
$('#storage-info').onclick=storageDialog;
function helpDialog(){
  modal('Votre musique, simplement',`<div class="modal-copy"><h3>1. Installer sur l’iPhone</h3><p>Ouvrez l’adresse HTTPS de Sillage dans Safari. Touchez Partager → Sur l’écran d’accueil → Ajouter. Lancez ensuite l’icône Sillage <strong>avant d’importer les morceaux</strong>. Une adresse localhost sur le PC n’est pas accessible depuis l’iPhone.</p><h3>2. Emporter vos titres</h3><p>Touchez <strong>Synchroniser</strong> sur le PC et choisissez « Ce PC envoie ma musique ». Sur l’iPhone, ouvrez Sillage depuis son icône, touchez Synchroniser et saisissez le code du PC une seule fois. Les prochains ajouts et playlists seront copiés automatiquement tant que Sillage est ouvert sur les deux appareils. Privilégiez le même Wi-Fi. Attendez « À jour » avant de partir.</p><h3>3. Écouter sans réseau</h3><p>Lancez un morceau, puis verrouillez l’écran. Les commandes de lecture sont prévues pour l’écran verrouillé. Testez aussi le passage au titre suivant : le comportement dépend de votre version d’iOS. Ne forcez pas la fermeture de l’application pendant l’écoute.</p><h3>Avant de partir</h3><p>Passez en mode avion, relancez Sillage et essayez plusieurs morceaux. Gardez une sauvegarde .sillage sur votre PC. Le navigateur peut supprimer des données en cas de nettoyage ou de manque de place.</p><h3>Ce qui reste sur votre appareil</h3><p>Les fichiers audio et playlists sont conservés localement. Avec la synchronisation, les morceaux sont envoyés directement et chiffrés à votre appareil associé. Le service gratuit PeerJS aide à établir la liaison, sans stocker votre musique. Aucun abonnement, aucune publicité. Le site qui fournit l’interface doit être ouvert une première fois en ligne.</p></div><div class="form-actions"><button id="help-sync" class="button primary">Synchroniser mes appareils</button><button id="help-transfer" class="button text-button">Sauvegarde manuelle</button></div>`);
  if($('#help-transfer'))$('#help-transfer').onclick=transferDialog;if($('#help-sync'))$('#help-sync').onclick=syncDialog;
}
$('#help').onclick=helpDialog;$('#mobile-help').onclick=helpDialog;
function queueDialog(){
  if(!modal('En cours d’écoute',`<div class="modal-copy"><p>${player.queue.length} morceau${player.queue.length>1?'x':''} dans la file</p></div><div class="form-actions" style="justify-content:flex-start;margin:0 0 18px"><button class="button text-button" id="queue-shuffle">Aléatoire : ${player.shuffle?'oui':'non'}</button><button class="button text-button" id="queue-repeat">Répéter : ${player.mode==='off'?'non':player.mode==='one'?'ce titre':'la file'}</button><button class="button text-button" id="queue-prev">Précédent</button></div><div class="modal-menu">${player.queue.map((id,i)=>`<button class="menu-button" data-queue="${i}">${icon(i===player.index?'music':'play')}${esc(player.tracks.get(id)?.title)}</button>`).join('')||'<p class="modal-copy">Choisissez un morceau dans votre bibliothèque.</p>'}</div>`))return;
  $('#queue-shuffle').onclick=()=>{player.shuffle=!player.shuffle;updatePlayer();queueDialog();};$('#queue-repeat').onclick=()=>{$('#repeat').click();queueDialog();};$('#queue-prev').onclick=()=>player.previous();
  $$('[data-queue]').forEach(b=>b.onclick=()=>{player.index=+b.dataset.queue;player.load();closeModal();});
}
$('#queue').onclick=queueDialog;$('#now-playing').onclick=queueDialog;
function demoFile(){
  // Original, generated locally: a short ambient chord progression, no remote audio.
  const rate=22050,seconds=18,n=rate*seconds,buffer=new ArrayBuffer(44+n*2),v=new DataView(buffer);const str=(i,s)=>[...s].forEach((c,j)=>v.setUint8(i+j,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
  const chords=[[130.81,164.81,196],[110,130.81,164.81],[87.31,130.81,174.61]];
  for(let i=0;i<n;i++){const t=i/rate,c=chords[Math.min(2,Math.floor(t/6))],part=t%6,env=Math.min(1,part/.5)*Math.min(1,(6-part)/1.5);let a=0;for(const f of c)a+=Math.sin(2*Math.PI*f*t)*.12+Math.sin(2*Math.PI*f*2*t)*.025;a*=env*.6;v.setInt16(44+i*2,Math.max(-1,Math.min(1,a))*32767,true);}
  return new File([buffer],'Sillage - Horizon (démonstration).wav',{type:'audio/wav'});
}
$('#demo').onclick=async()=>{importDialog();await importFiles([demoFile()]);closeModal();if(library.tracks.length)player.playList([library.tracks[0].id]);};
function network(){const offline=!navigator.onLine;$('#network-label').textContent=offline?'Mode hors connexion':'Bibliothèque locale';$('.top-status').classList.toggle('offline',offline);}
window.addEventListener('online',network);window.addEventListener('offline',network);
async function boot(){
  network();
  try{await refresh();}catch(e){$('#offline-status').textContent='Stockage local indisponible';modal('Stockage indisponible',`<p class="modal-copy">${esc(e.message)} Ouvrez Sillage dans une fenêtre normale de Safari ou de votre navigateur, puis réessayez.</p>`);return;}
  updateSyncStatus(sync,$);sync.start();
  if('serviceWorker' in navigator && window.isSecureContext){
    try{const registration=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;offlineReady=true;$('#offline-status').textContent='Interface prête hors connexion · musique locale';registration.update().catch(()=>{});}catch{$('#offline-status').textContent='Interface non préparée hors connexion · réessayez en ligne';}
  }else $('#offline-status').textContent='Une adresse HTTPS est nécessaire pour le mode hors connexion';
  if(['localhost','127.0.0.1'].includes(location.hostname))try{const r=await fetch('./api/status');if(r.ok&&r.headers.get('Content-Type')?.includes('application/json'))pc=await r.json();}catch{}
}
boot();
