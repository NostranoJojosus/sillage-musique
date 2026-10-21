// Local RPC implementation; the PC bridge loads it outside the app-shell cache.
const ID=/^[a-f0-9]{32}$/;
const unavailable=message=>Object.assign(Error(message),{kind:'network'});
const requestLocal=(url,options)=>fetch(url,options).catch(()=>{throw unavailable('Le lanceur Windows ne répond pas. Relancez Demarrer-Sillage.cmd.');});
async function readLocalJson(response){
  // fetch can succeed at the headers, then fail while reading the response.
  try{return await response.json();}
  catch(error){
    if(['TypeError','AbortError','NetworkError'].includes(error?.name))throw unavailable('La réponse du programme du PC a été interrompue.');
    throw error;
  }
}
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
  const status=await requestLocal('./api/status',{cache:'no-store'}).then(r=>{if(!r.ok)throw unavailable('Lancez Demarrer-Sillage.cmd sur le PC.');return readLocalJson(r);});
  if(command==='status')return {available:status.available,ready:status.ready,httpsSync:status.httpsSync};
  if(command.startsWith('sync-')){
    const response=await requestLocal('./api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Sillage-Token':status.token},body:JSON.stringify({action:command.slice(5),...args})});
    const data=await readLocalJson(response);if(!response.ok)throw Error(data.error||'La synchronisation PC ne répond pas.');return data;
  }
  const discover=['spotify','search'].includes(command);
  let url=discover?'./api/discover':command==='jobs'?'./api/jobs':command==='submit'?'./api/youtube':`./api/${command==='audio'?'audio':'jobs'}/${args.id}`;
  const response=await fetch(url,command==='submit'||discover?{method:'POST',headers:{'Content-Type':'application/json','X-Sillage-Token':status.token},body:JSON.stringify(discover?{kind:command,...args}:{url:args.url,requestId:args.requestId})}:{cache:'no-store'});
  if(command==='audio' && response.ok){const blob=await response.blob();if(blob.size>100*1024*1024)throw Error('Morceau trop volumineux.');return blob;}
  const data=await readLocalJson(response);if(!response.ok && !data.busy)throw Error(data.error||'Le convertisseur ne répond pas.');return data;
}

