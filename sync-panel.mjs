import {displayCode} from './sync-protocol.mjs';
import {profileId,profileName,invitation,readPairingInvitation,renderProfileQR} from './profile.mjs';
import {normalizeRelayUrl} from './https-sync.mjs';

const renderedQRs=new WeakMap();
const httpsExplanation='<p class="notice">La connexion HTTPS est gratuite, sans compte supplémentaire. Cloudflare relaie vos morceaux et playlists déjà chiffrés par le PC. PeerJS transmet seulement un petit message contenant l’adresse de connexion chiffrée, sans musique ni clé privée. Ces services voient des informations de connexion ; leur disponibilité n’est pas garantie.</p>';
const reconnectionExplanation='<p class="notice">L’association est mémorisée : après avoir relancé le partage sur le PC, ouvrez simplement Sillage sur l’iPhone pour retrouver automatiquement le PC.</p>';

function panelFeedback($,text,kind='info') {
  const el=$('#sync-feedback');if(!el)return;el.textContent=text;el.dataset.kind=kind;el.hidden=!text;
}

export async function syncPanel(manager,{modal,$,esc,toast,count,initialCode='',initialError='',initialRelayUrl=''}) {
  const s=manager.settings,pair=initialCode?readPairingInvitation(initialCode):null,incoming=pair?.code||'';
  const incomingRelay=initialRelayUrl?normalizeRelayUrl(initialRelayUrl):pair?.relayUrl;
  const status=`<div class="sync-live" role="status"><strong id="sync-live-text"${incoming?' data-invitation="pending"':''}></strong><div class="progress" id="sync-progress-track"><i id="sync-progress"></i></div></div><p id="sync-feedback" class="notice sync-feedback" role="status" hidden></p>`;
  const conditions='<p class="notice">Pendant la copie, gardez Sillage ouvert sur les deux appareils. Attendez « À jour » sur l’iPhone : vous pourrez ensuite écouter avec le PC éteint.</p>';
  const privacy='<details class="sync-details"><summary>Fonctionnement et confidentialité</summary><p>Les morceaux sont copiés sur l’iPhone pour l’écoute hors connexion. Ce profil est une association privée, sans compte musical ni hébergement permanent de la bibliothèque.</p><p>En mode HTTPS, Cloudflare relaie des fichiers déjà chiffrés par Sillage et voit les adresses IP ainsi que le volume transféré. PeerJS aide l’iPhone à retrouver le PC en transmettant son adresse de connexion chiffrée : ni musique ni clé privée ne lui sont envoyées. En mode direct, PeerJS et un serveur STUN aident à joindre vos appareils. Ces services voient des informations de connexion.</p><p>La recherche du PC et la copie se font quand Sillage est ouvert. iOS peut les suspendre en arrière-plan : gardez Sillage visible pendant la copie.</p><p>Les playlists suivent le PC et les favoris de l’iPhone sont conservés. Une suppression sur le PC n’efface pas la copie sur l’iPhone. Un morceau supprimé seulement de l’iPhone sera recopié tant qu’il reste sur le PC.</p></details>';
  let html=status;
  if(incoming) {
    html+='<p class="modal-copy">Le lien de votre PC est reconnu. Touchez le bouton pour associer cet appareil et copier votre musique.</p>';
    if(incomingRelay)html+=httpsExplanation;
    if(s && (s.code!==incoming || s.role==='source'))html+='<p class="notice">Cette action remplace l’association de cet appareil. Sa musique déjà présente reste conservée.</p>';
    html+=`<form id="sync-pair-form"><button class="button primary full" id="sync-pair-submit">Recevoir ma musique</button><details class="sync-details"><summary>Voir ou modifier le lien</summary><label class="form-label" for="sync-pair-code">${incomingRelay?'Lien privé complet du PC':'Clé privée du PC'}</label><input id="sync-pair-code" class="field sync-code-input" value="${esc(incomingRelay?invitation(incoming,incomingRelay):displayCode(incoming))}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="500" required></details></form>`;
  } else if(!s) {
    html+=`<div class="sync-choices"><p class="modal-copy">Sur le PC où se trouve votre musique, créez votre profil. L’iPhone pourra ensuite le rejoindre avec un QR.</p><button id="sync-source" class="button primary full">Préparer ce PC (${count()} titre${count()>1?'s':''})</button><form id="sync-pair-form"><label class="form-label" for="sync-pair-code">Sur l’iPhone : collez le lien ou la clé du PC</label><input id="sync-pair-code" class="field sync-code-input" placeholder="Lien privé ou clé du PC" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="300" required><button id="sync-pair-submit" class="button primary full" style="margin-top:12px">Recevoir ma musique</button></form></div>`;
  } else {
    const id=await profileId(s.code);
    html+=`<p class="modal-copy"><strong>${esc(profileName(s.name))}</strong> · ${s.role==='source'?'Ce PC envoie votre bibliothèque.':'Cet appareil reçoit votre bibliothèque du PC.'}</p>`;
    if(s.transport==='https')html+=reconnectionExplanation;
    if(s.role==='source') {
      html+=httpsExplanation+`<button id="sync-https" class="button primary full">${s.transport==='https'?'Préparer / relancer le lien HTTPS':'Activer la connexion HTTPS gratuite'}</button><p class="modal-copy">Avec le démarrage automatique Windows configuré, Sillage et le partage reprennent à l’ouverture de votre session. Gardez cet onglet ouvert pendant la copie. Le bouton ci-dessus reste disponible en dépannage.</p><section id="profile-pairing"><p id="profile-pairing-copy" class="modal-copy"></p><div id="profile-qr" class="profile-qr" hidden></div><p id="profile-pairing-help" class="modal-copy" hidden>Utilisez toujours le même navigateur ou la même icône Sillage sur l’iPhone pour retrouver vos morceaux.</p></section>`;
    } else {
      html+='<p class="modal-copy">L’association est mémorisée. Les nouveaux morceaux seront reçus lorsque les deux appareils pourront se connecter.</p>';
      if(s.transport==='https')html+=httpsExplanation+'<p class="notice">Pour les conversions YouTube ou Spotify, ajoutez les liens sur le PC. Leurs MP3 seront ensuite copiés ici.</p>';
      html+='<details class="sync-details"><summary>Utiliser un lien du PC en dépannage</summary><form id="sync-pair-form"><label class="form-label" for="sync-pair-code">Lien privé complet affiché sur le PC</label><input id="sync-pair-code" class="field sync-code-input" placeholder="Collez le lien privé" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="500" required><button id="sync-pair-submit" class="button primary full" style="margin-top:12px">Recevoir ma musique</button></form></details>';
    }
    if(!(s.role==='source' && s.transport==='https')) {
      if(!s.enabled)html+='<button class="button primary full" id="sync-resume" style="margin-top:12px">Reprendre la synchronisation</button>';
      else html+='<button class="button text-button full" id="sync-retry" style="margin-top:12px">Relancer la connexion</button>';
    }
    html+=`<details class="sync-details"><summary>Clé et réglages du profil</summary><p>ID : <strong>${esc(id)}</strong></p><form id="profile-name-form"><label class="form-label" for="profile-name">Nom affiché sur cet appareil</label><div class="profile-name-row"><input class="field" id="profile-name" maxlength="60" value="${esc(profileName(s.name))}"><button class="button text-button">Enregistrer</button></div></form><p>Le lien et la clé donnent accès à votre bibliothèque. Gardez-les privés. Le QR est créé localement.</p><button id="profile-copy-link" class="button text-button full">Copier mon lien privé complet</button><p class="form-label">Ma clé privée</p><output class="sync-code">${esc(displayCode(s.code))}</output><button id="sync-copy-code" class="button text-button full">Copier ma clé</button><p>Privilégiez le QR ou le lien privé complet pour la première association ou un dépannage. Si vous utilisez l’icône Sillage sur l’écran d’accueil de l’iPhone, collez le lien dans cette application. Les prochaines connexions conservent cette association.</p><button class="button text-button full" id="sync-pause">${s.enabled?'Mettre la synchronisation en pause':'Reprendre la synchronisation'}</button><button class="sync-forget" id="sync-forget">Dissocier cet appareil (garder la musique)</button></details>`;
  }
  html+=conditions+privacy;
  if(!modal(incoming?'Recevoir ma musique':'Mes appareils',html))return;
  const feedback=(text,kind='info')=>panelFeedback($,text,kind);
  const redraw=()=>syncPanel(manager,{modal,$,esc,toast,count});
  let working=false;
  const run=async(fn,button)=>{
    if(working)return;working=true;if(button)button.disabled=true;
    feedback('Préparation de la connexion…');
    try{await fn();await redraw();}
    catch(error){if(manager.settings!==s)await redraw();feedback(error.message||'La demande n’a pas abouti. Réessayez.','error');}
    finally{working=false;if(button?.isConnected)button.disabled=false;updateSyncStatus(manager,$);}
  };
  if($('#sync-source'))$('#sync-source').onclick=event=>run(()=>manager.configure('source'),event.currentTarget);
  if($('#sync-pair-form'))$('#sync-pair-form').onsubmit=event=>{event.preventDefault();run(()=>{const next=readPairingInvitation($('#sync-pair-code').value);if($('#sync-live-text'))delete $('#sync-live-text').dataset.invitation;return manager.configure('receiver',next.code,undefined,next.relayUrl||(next.code===incoming?incomingRelay:undefined));},$('#sync-pair-submit'));};
  if($('#sync-https'))$('#sync-https').onclick=event=>{
    if(working)return;
    // The companion popup must open while the click still has user activation.
    let operation;try{operation=manager.enableHTTPSFromClick();}catch(error){feedback(error.message,'error');return;}
    run(()=>operation,event.currentTarget);
  };
  if($('#profile-name-form'))$('#profile-name-form').onsubmit=event=>{event.preventDefault();run(()=>manager.rename($('#profile-name').value));};
  if($('#profile-copy-link'))$('#profile-copy-link').onclick=async()=>{try{const current=manager.settings;if(current.transport==='https' && !current.relayUrl)throw Error('Préparez d’abord le lien HTTPS sur le PC.');await navigator.clipboard.writeText(invitation(current.code,current.transport==='https'?current.relayUrl:undefined));feedback('Lien copié. Collez-le dans Sillage sur l’iPhone.');}catch(error){feedback(error.message||'Copie indisponible. Utilisez le QR du PC.','error');}};
  if($('#sync-copy-code'))$('#sync-copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(displayCode(s.code));feedback('Clé copiée. Collez-la dans Sillage sur l’iPhone.');}catch{feedback('Sélectionnez la clé ci-dessus pour la copier.','error');}};
  if($('#sync-pause'))$('#sync-pause').onclick=event=>run(()=>s.enabled?manager.pause():manager.resume(),event.currentTarget);
  if($('#sync-resume'))$('#sync-resume').onclick=event=>run(()=>manager.resume(),event.currentTarget);
  if($('#sync-retry'))$('#sync-retry').onclick=event=>run(()=>manager.resume(),event.currentTarget);
  if($('#sync-forget'))$('#sync-forget').onclick=event=>run(()=>manager.forget(),event.currentTarget);
  updateSyncStatus(manager,$);
  if(initialError)feedback(initialError,'error');
}

export function updateSyncStatus(manager,$) {
  const state=manager.status,role=manager.settings?.role;
  if($('#sync-label'))$('#sync-label').textContent=role==='source'?'Connecter mon iPhone':role==='receiver'?'Mes appareils':'Connecter mes appareils';
  if($('#sync-status')){$('#sync-status').textContent=state.text;$('#sync-status').dataset.kind=state.kind;}
  const pending=$('#sync-live-text')?.dataset.invitation==='pending';
  if($('#sync-live-text')){$('#sync-live-text').textContent=pending?'Prêt à associer cet appareil':state.text;$('#sync-live-text').dataset.kind=pending?'waiting':state.kind;}
  if($('#sync-progress'))$('#sync-progress').style.width=(state.progress!==undefined?Math.round(state.progress*100):state.done?100:0)+'%';
  if($('#sync-progress-track'))$('#sync-progress-track').hidden=pending || state.progress===undefined && !state.done;
  const s=manager.settings,qr=$('#profile-qr');
  if(qr && s?.role==='source') {
    const https=s.transport==='https',ready=s.enabled && (!https || !!s.relayUrl && state.kind==='ready' && state.done);
    qr.hidden=!ready;
    if($('#profile-pairing-help'))$('#profile-pairing-help').hidden=!ready;
    if($('#profile-pairing-copy'))$('#profile-pairing-copy').textContent=ready?(https?'Première association ou dépannage : scannez ce QR avec l’iPhone, puis touchez « Recevoir ma musique ».':'Avec l’appareil photo de l’iPhone, scannez ce QR, puis touchez « Recevoir ma musique ».'):https?'Le QR apparaîtra quand le lien HTTPS et la musique seront prêts.':'Reprenez la synchronisation pour afficher le QR.';
    if($('#profile-copy-link'))$('#profile-copy-link').disabled=!ready;
    if(!ready){qr.innerHTML='';renderedQRs.delete(qr);}
    else {
      const relay=https?s.relayUrl:undefined,previous=renderedQRs.get(qr);
      if(previous?.code!==s.code || previous?.relay!==relay) {
        const version={code:s.code,relay};renderedQRs.set(qr,version);
        renderProfileQR(qr,s.code,relay).catch(error=>{if(qr.isConnected && renderedQRs.get(qr)===version){renderedQRs.delete(qr);panelFeedback($,error.message,'error');}});
      }
    }
  }
}
