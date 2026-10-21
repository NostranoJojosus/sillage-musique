import {localCall,validCommand} from './companion.mjs';
import {PUBLIC_APP} from './profile.mjs';
const nonce=location.hash.slice(1),parent=window.opener,origin=new URL(PUBLIC_APP).origin;
history.replaceState(null,'',location.pathname);
const label=document.querySelector('#bridge-status');
if(!parent || !/^[a-f0-9]{32}$/.test(nonce))label.textContent='Ouvrez cette fenêtre depuis le bouton YouTube de Sillage.';
else {
  let inflight=0;
  window.addEventListener('message',async event=>{
    const m=event.data;
    if(event.source!==parent || event.origin!==origin || m?.nonce!==nonce || m.type!=='request' || !/^[a-f0-9]{32}$/.test(m.id||'') || !validCommand(m.command,m.args) || inflight>=8)return;
    inflight++;
    try{const result=await localCall(m.command,m.args);parent.postMessage({type:'result',nonce,id:m.id,result},origin);}
    catch(error){parent.postMessage({type:'result',nonce,id:m.id,error:error.message},origin);}
    finally{inflight--;}
  });
  try{const status=await localCall('status');label.textContent=status.ready?'Convertisseur prêt · retournez au lecteur Sillage':'Lancez Installer-outils.cmd, puis rouvrez cette fenêtre.';parent.postMessage({type:'ready',nonce,status},origin);}
  catch{label.textContent='Le lanceur Windows ne répond pas. Relancez Demarrer-Sillage.cmd.';}
}
