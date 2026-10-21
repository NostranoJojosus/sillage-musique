let peerScript;
export async function loadPeer() {
  if(window.Peer)return window.Peer;
  if(!peerScript)peerScript=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL('./peerjs.min.js',import.meta.url).href;
    script.onload=()=>resolve(window.Peer);
    script.onerror=()=>{peerScript=null;script.remove();reject(Error('Le service de reconnexion est indisponible. Nouvelle tentative automatique.'));};
    document.head.append(script);
  });
  return peerScript;
}
