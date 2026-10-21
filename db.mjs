let pending;
export function database(){
  if(!pending)pending=new Promise((resolve,reject)=>{
    const r=indexedDB.open('sillage-library',1);
    r.onupgradeneeded=()=>{for(const name of ['tracks','blobs','playlists'])r.result.createObjectStore(name,{keyPath:'id'});};
    r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();pending=null;};resolve(r.result);};
    r.onerror=()=>{pending=null;reject(r.error);};r.onblocked=()=>reject(Error('Fermez les autres onglets Sillage, puis réessayez.'));
  });
  return pending;
}
async function read(store,key){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store);const r=key===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function write(stores,fn){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Enregistrement interrompu.'));try{fn(tx);}catch(e){tx.abort();reject(e);}});}
export const getBlob=async id=>(await read('blobs',id))?.blob;
export const getLibrary=async()=>({tracks:await read('tracks'),playlists:await read('playlists')});
export const saveTrack=t=>write(['tracks'],tx=>tx.objectStore('tracks').put(t));
export const savePlaylist=p=>write(['playlists'],tx=>tx.objectStore('playlists').put(p));
export const commitMetadata=(tracks,playlists)=>write(['tracks','playlists'],tx=>{for(const t of tracks)tx.objectStore('tracks').put(t);for(const p of playlists)tx.objectStore('playlists').put(p);});
export const deletePlaylist=id=>write(['playlists'],tx=>tx.objectStore('playlists').delete(id));
export const commitImport=(entries,playlists)=>write(['tracks','blobs','playlists'],tx=>{for(const {track,blob} of entries){tx.objectStore('tracks').put(track);tx.objectStore('blobs').put({id:track.id,blob});}for(const p of playlists)tx.objectStore('playlists').put(p);});
export const removeTrack=(id,playlists)=>write(['tracks','blobs','playlists'],tx=>{tx.objectStore('tracks').delete(id);tx.objectStore('blobs').delete(id);for(const p of playlists)tx.objectStore('playlists').put({...p,trackIds:p.trackIds.filter(x=>x!==id)});});
