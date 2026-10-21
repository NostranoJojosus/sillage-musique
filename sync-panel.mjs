import {displayCode} from './sync-protocol.mjs';
import {profileId,profileName,invitation,readInvitation,renderProfileQR} from './profile.mjs';

export async function syncPanel(manager,{modal,$,esc,toast,count,initialCode='',initialError=''}) {
  const s=manager.settings,incoming=initialCode?readInvitation(initialCode):'';
  const status=`<div class="sync-live" role="status"><strong id="sync-live-text"${incoming?' data-invitation="pending"':''}></strong><div class="progress" id="sync-progress-track"><i id="sync-progress"></i></div></div><p id="sync-feedback" class="notice sync-feedback" role="status" hidden></p>`;
  const conditions='<p class="notice">Pendant la copie, gardez Sillage ouvert sur les deux appareils. Attendez « À jour » sur l’iPhone : vous pourrez ensuite écouter avec le PC éteint.</p>';
  const privacy='<details class="sync-details"><summary>Fonctionnement et confidentialité</summary><p>Les morceaux sont copiés sur l’iPhone pour l’écoute hors connexion. Ce profil est une association privée, sans compte ni stockage musical en ligne.</p><p>La musique passe directement et chiffrée entre vos appareils. PeerJS et un serveur STUN aident à établir la connexion et voient des informations de connexion, dont les adresses IP. Certains réseaux empêchent cette liaison. La copie peut s’arrêter quand iOS ferme ou suspend Sillage.</p><p>Les playlists suivent le PC et les favoris de l’iPhone sont conservés. Une suppression sur le PC n’efface pas la copie sur l’iPhone. Un morceau supprimé seulement de l’iPhone sera recopié tant qu’il reste sur le PC.</p></details>';
  let html=status;
  if(incoming) {
    html+='<p class="modal-copy">Le lien de votre PC est reconnu. Touchez le bouton pour associer cet appareil et copier votre musique.</p>';
    if(s && (s.code!==incoming || s.role==='source'))html+='<p class="notice">Cette action remplace l’association de cet appareil. Sa musique déjà présente reste conservée.</p>';
    html+=`<form id="sync-pair-form"><button class="button primary full" id="sync-pair-submit">Recevoir ma musique</button><details class="sync-details"><summary>Voir ou modifier la clé</summary><label class="form-label" for="sync-pair-code">Clé privée du PC</label><input id="sync-pair-code" class="field sync-code-input" value="${esc(displayCode(incoming))}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" required></details></form>`;
  } else if(!s) {
    html+=`<div class="sync-choices"><p class="modal-copy">Sur le PC où se trouve votre musique, créez votre profil. L’iPhone pourra ensuite le rejoindre avec un QR.</p><button id="sync-source" class="button primary full">Préparer ce PC (${count()} titre${count()>1?'s':''})</button><form id="sync-pair-form"><label class="form-label" for="sync-pair-code">Sur l’iPhone : collez le lien ou la clé du PC</label><input id="sync-pair-code" class="field sync-code-input" placeholder="Lien privé ou clé du PC" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" required><button id="sync-pair-submit" class="button primary full" style="margin-top:12px">Recevoir ma musique</button></form></div>`;
  } else {
    const id=await profileId(s.code);
    html+=`<p class="modal-copy"><strong>${esc(profileName(s.name))}</strong> · ${s.role==='source'?'Ce PC envoie votre bibliothèque.':'Cet appareil reçoit votre bibliothèque du PC.'}</p>`;
    if(s.role==='source')html+='<section id="profile-pairing"><p class="modal-copy">Avec l’appareil photo de l’iPhone, scannez ce QR, puis touchez « Recevoir ma musique ».</p><div id="profile-qr" class="profile-qr"></div><p class="modal-copy">Utilisez toujours le même navigateur ou la même icône Sillage sur l’iPhone pour retrouver vos morceaux.</p></section>';
    else html+='<p class="modal-copy">L’association est mémorisée. Les nouveaux morceaux seront reçus lorsque les deux appareils pourront se connecter.</p>';
    if(!s.enabled)html+='<button class="button primary full" id="sync-resume" style="margin-top:12px">Reprendre la synchronisation</button>';
    else html+='<button class="button text-button full" id="sync-retry" style="margin-top:12px">Relancer la connexion</button>';
    html+=`<details class="sync-details"><summary>Clé et réglages du profil</summary><p>ID : <strong>${esc(id)}</strong></p><form id="profile-name-form"><label class="form-label" for="profile-name">Nom affiché sur cet appareil</label><div class="profile-name-row"><input class="field" id="profile-name" maxlength="60" value="${esc(profileName(s.name))}"><button class="button text-button">Enregistrer</button></div></form><p>Le lien et la clé donnent accès à votre bibliothèque et aux demandes YouTube sur votre PC. Gardez-les privés. Le QR est créé localement.</p><button id="profile-copy-link" class="button text-button full">Copier mon lien privé</button><p class="form-label">Ma clé privée</p><output class="sync-code">${esc(displayCode(s.code))}</output><button id="sync-copy-code" class="button text-button full">Copier ma clé</button><p>Si vous utilisez l’icône Sillage sur l’écran d’accueil de l’iPhone, ouvrez cette icône et collez le lien ou la clé dans « Connecter mes appareils ».</p><button class="button text-button full" id="sync-pause">${s.enabled?'Mettre la synchronisation en pause':'Reprendre la synchronisation'}</button><button class="sync-forget" id="sync-forget">Dissocier cet appareil (garder la musique)</button></details>`;
  }
  html+=conditions+privacy;
  if(!modal(incoming?'Recevoir ma musique':'Mes appareils',html))return;
  const feedback=(text,kind='info')=>{const el=$('#sync-feedback');if(!el)return;el.textContent=text;el.dataset.kind=kind;el.hidden=!text;};
  const redraw=()=>syncPanel(manager,{modal,$,esc,toast,count});
  let working=false;
  const run=async(fn,button)=>{
    if(working)return;working=true;if(button)button.disabled=true;
    feedback('Préparation de la connexion…');
    try{await fn();await redraw();}
    catch(error){feedback(error.message||'La demande n’a pas abouti. Réessayez.','error');}
    finally{working=false;if(button?.isConnected)button.disabled=false;}
  };
  if($('#sync-source'))$('#sync-source').onclick=event=>run(()=>manager.configure('source'),event.currentTarget);
  if($('#sync-pair-form'))$('#sync-pair-form').onsubmit=event=>{event.preventDefault();run(()=>manager.configure('receiver',readInvitation($('#sync-pair-code').value)),$('#sync-pair-submit'));};
  if($('#profile-name-form'))$('#profile-name-form').onsubmit=event=>{event.preventDefault();run(()=>manager.rename($('#profile-name').value));};
  if($('#profile-copy-link'))$('#profile-copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(invitation(s.code));feedback('Lien copié. Collez-le dans Sillage sur l’iPhone.');}catch{feedback('Copie indisponible. Sélectionnez la clé privée ci-dessous.','error');}};
  if($('#sync-copy-code'))$('#sync-copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(displayCode(s.code));feedback('Clé copiée. Collez-la dans Sillage sur l’iPhone.');}catch{feedback('Sélectionnez la clé ci-dessus pour la copier.','error');}};
  if($('#sync-pause'))$('#sync-pause').onclick=event=>run(()=>s.enabled?manager.pause():manager.resume(),event.currentTarget);
  if($('#sync-resume'))$('#sync-resume').onclick=event=>run(()=>manager.resume(),event.currentTarget);
  if($('#sync-retry'))$('#sync-retry').onclick=event=>run(()=>manager.resume(),event.currentTarget);
  if($('#sync-forget'))$('#sync-forget').onclick=event=>run(()=>manager.forget(),event.currentTarget);
  updateSyncStatus(manager,$);
  if(initialError)feedback(initialError,'error');
  if($('#profile-qr'))renderProfileQR($('#profile-qr'),s.code).catch(error=>feedback(error.message,'error'));
}

export function updateSyncStatus(manager,$) {
  const state=manager.status,role=manager.settings?.role;
  if($('#sync-label'))$('#sync-label').textContent=role==='source'?'Connecter mon iPhone':role==='receiver'?'Mes appareils':'Connecter mes appareils';
  if($('#sync-status')){$('#sync-status').textContent=state.text;$('#sync-status').dataset.kind=state.kind;}
  const pending=$('#sync-live-text')?.dataset.invitation==='pending';
  if($('#sync-live-text')){$('#sync-live-text').textContent=pending?'Prêt à associer cet appareil':state.text;$('#sync-live-text').dataset.kind=pending?'waiting':state.kind;}
  if($('#sync-progress'))$('#sync-progress').style.width=(state.progress!==undefined?Math.round(state.progress*100):state.done?100:0)+'%';
  if($('#sync-progress-track'))$('#sync-progress-track').hidden=pending || state.progress===undefined && !state.done;
}
