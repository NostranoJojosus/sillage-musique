const TYPES={track:'Morceau',playlist:'Playlist',artist:'Artiste'};
export function spotifyLink(value,label='') {
  let parts;const input=String(value||'').trim();
  if(input.startsWith('spotify:'))parts=input.split(':').slice(1);
  else {
    let u;try{u=new URL(input);}catch{throw Error('Collez le lien de partage Spotify du morceau, de la playlist ou de l’artiste.');}
    if(u.protocol!=='https:' || u.hostname!=='open.spotify.com' || u.username || u.password || u.port)throw Error('Utilisez un lien https://open.spotify.com (ouvrir les liens raccourcis dans Spotify d’abord).');
    parts=u.pathname.split('/').filter(Boolean);if(/^intl-[a-z-]+$/i.test(parts[0]))parts.shift();
  }
  const [type,id]=parts;
  if(parts.length!==2 || !TYPES[type] || !/^[A-Za-z0-9]{22}$/.test(id||''))throw Error('Ce lien doit désigner un morceau, une playlist ou un artiste Spotify.');
  const name=String(label||'').trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,120)||`${TYPES[type]} Spotify · ${id.slice(-5)}`;
  return {id:`${type}-${id}`,type,url:`https://open.spotify.com/${type}/${id}`,name};
}
export function validateSpotifyLinks(value) {
  if(!Array.isArray(value) || value.length>200)throw Error('La collection Spotify peut contenir au maximum 200 liens.');
  const seen=new Set();return value.map(item=>{
    if(!item || typeof item.name!=='string' || item.name.length>120)throw Error('Nom Spotify invalide.');
    const link=spotifyLink(item.url,item.name);if(link.id!==item.id || link.type!==item.type || seen.has(link.id))throw Error('Lien Spotify invalide ou en double.');seen.add(link.id);return link;
  });
}
export class SpotifyLinks extends EventTarget {
  constructor(storage=localStorage){super();this.storage=storage;try{this.items=validateSpotifyLinks(JSON.parse(storage.getItem('sillage-spotify-v1')||'[]'));}catch{this.items=[];}}
  write(items){this.storage.setItem('sillage-spotify-v1',JSON.stringify(items));this.items=items;this.dispatchEvent(new Event('change'));}
  add(url,name){const link=spotifyLink(url,name),other=this.items.filter(i=>i.id!==link.id);if(other.length>=200)throw Error('Votre collection contient déjà 200 liens.');this.write([link,...other]);return link;}
  remove(id){this.write(this.items.filter(i=>i.id!==id));}
  merge(incoming){const links=validateSpotifyLinks(incoming||[]);if(!links.length)return;const byId=new Map(this.items.map(i=>[i.id,i]));for(const l of links)byId.set(l.id,l);if(byId.size>200)throw Error('La collection Spotify de cet appareil est pleine (200 liens).');const next=[...byId.values()];if(JSON.stringify(next)!==JSON.stringify(this.items))this.write(next);}
}
export function spotifyPanel(store,{modal,$,esc,toast,discover,addYouTube,converter}){
  if(!modal('Depuis Spotify, retrouver une version YouTube',`<p class="modal-copy">Collez un lien Spotify. Pour un morceau ou un artiste, Sillage tente de lire son nom public puis propose des versions YouTube. <strong>Vérifiez la version avant de la convertir en MP3.</strong></p><form id="spotify-form"><label class="form-label" for="spotify-url">Lien Spotify</label><input class="field" id="spotify-url" placeholder="https://open.spotify.com/track/…" required autocomplete="off"><label class="form-label" for="spotify-name">Nom à conserver (facultatif)</label><input class="field" id="spotify-name" placeholder="Titre ou artiste…" maxlength="120"><button class="button primary full" style="margin-top:12px">Retrouver sur YouTube</button><p id="spotify-feedback" class="import-status" role="status"></p></form><button id="spotify-converter" class="button text-button full">Configurer le convertisseur sur le PC</button><div id="spotify-find"></div><label class="form-label" for="spotify-filter">Mes références enregistrées</label><select id="spotify-filter" class="field"><option value="all">Tout</option><option value="track">Morceaux</option><option value="playlist">Playlists</option><option value="artist">Artistes</option></select><div id="spotify-list" class="spotify-list"></div><p class="notice">Le MP3 proviendra de la vidéo YouTube choisie, pas de Spotify. Les playlists entières et toutes les œuvres d’un artiste ne sont pas importées automatiquement. Le PC et son convertisseur doivent être disponibles ; aucun abonnement Spotify n’est nécessaire pour cette recherche publique.</p>`))return;
  const root=$('#spotify-find');let generation=0;
  const current=n=>root.isConnected && $('#spotify-find')===root && n===generation;
  const search=async(query,n)=>{
    if(!current(n))return;
    $('#spotify-search-status').textContent='Recherche de versions YouTube sur le PC…';$('#spotify-results').innerHTML='';
    const button=$('#spotify-search-form button');button.disabled=true;
    try{
      const result=await discover({action:'search',query});if(!current(n))return;
      const items=(result.items||[]).slice(0,5).filter(i=>/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(i.url||''));
      $('#spotify-search-status').textContent=items.length?'Comparez le titre, la chaîne et la durée, puis choisissez votre version.':'Aucun résultat. Précisez le titre et l’artiste, ou utilisez un lien YouTube directement.';
      $('#spotify-results').innerHTML=items.map((i,index)=>`<article class="youtube-result"><strong>${esc(i.title)}</strong><small>${esc(i.artist)} · ${Math.floor((i.duration||0)/60)}:${String(Math.floor((i.duration||0)%60)).padStart(2,'0')}</small><div><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Vérifier la vidéo ↗</a><button class="button primary small" data-youtube-choice="${index}">Convertir cette version en MP3</button></div></article>`).join('');
      for(const b of document.querySelectorAll('[data-youtube-choice]'))b.onclick=async()=>{b.disabled=true;try{await addYouTube(items[Number(b.dataset.youtubeChoice)].url);b.textContent='Ajouté à la file YouTube';toast('Version choisie : suivez sa conversion dans Ajouter un lien YouTube.');}catch(e){b.disabled=false;toast(e.message);}};
    }catch(e){if(current(n))$('#spotify-search-status').textContent=e.message;}
    finally{if(current(n))button.disabled=false;}
  };
  const find=async link=>{
    const n=++generation;
    root.innerHTML=`<h3>Choisir ma version</h3><form id="spotify-search-form"><label class="form-label" for="spotify-query">Titre et artiste à chercher sur YouTube</label><input class="field" id="spotify-query" maxlength="200" required minlength="2" value="${esc(link.name.includes('Spotify ·')?'':link.name)}"><button class="button text-button full" style="margin-top:10px">Rechercher des versions</button></form><p class="import-status" id="spotify-search-status" role="status">Lecture du nom public de la référence Spotify…</p><div id="spotify-results"></div>`;
    $('#spotify-search-form').onsubmit=e=>{e.preventDefault();const next=++generation;search($('#spotify-query').value,next);};
    try{
      const info=await discover({action:'spotify',url:link.url});if(!current(n))return;
      if(info.message){$('#spotify-search-status').textContent=info.message;return;}
      if(info.title){$('#spotify-query').value=info.title;if(link.name.includes('Spotify ·')){store.add(link.url,info.title);render();}await search(info.title,n);}
    }catch(e){if(current(n))$('#spotify-search-status').textContent=e.message+' Vous pouvez aussi saisir le titre et l’artiste ci-dessus.';}
  };
  const render=()=>{if(!$('#spotify-list'))return;const type=$('#spotify-filter').value;const items=store.items.filter(i=>type==='all'||i.type===type);$('#spotify-list').innerHTML=items.map(i=>`<article class="spotify-link"><span class="eyebrow">${TYPES[i.type]}</span><strong>${esc(i.name)}</strong><div><button class="button text-button small" data-spotify-find="${esc(i.id)}">Chercher une version YouTube</button><button class="icon-button" aria-label="Retirer la référence ${esc(i.name)}" data-spotify-remove="${esc(i.id)}">×</button></div></article>`).join('')||'<p class="modal-copy">Aucune référence dans cette catégorie.</p>';for(const b of document.querySelectorAll('[data-spotify-remove]'))b.onclick=()=>{try{store.remove(b.dataset.spotifyRemove);render();}catch(e){toast(e.message);}};for(const b of document.querySelectorAll('[data-spotify-find]'))b.onclick=()=>find(store.items.find(i=>i.id===b.dataset.spotifyFind));};
  $('#spotify-filter').onchange=render;$('#spotify-converter').onclick=converter;
  $('#spotify-form').onsubmit=e=>{e.preventDefault();try{const link=store.add($('#spotify-url').value,$('#spotify-name').value);$('#spotify-url').value='';$('#spotify-name').value='';$('#spotify-feedback').textContent='Référence enregistrée. Rien ne sera téléchargé avant votre choix.';render();find(link);}catch(e){$('#spotify-feedback').textContent=e.message;}};render();
}
