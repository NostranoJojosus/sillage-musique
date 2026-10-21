export const MAGIC = new TextEncoder().encode('SILLAGE1\n');
export const MAX_TRACK = 100 * 1024 * 1024;
export const MAX_PACK = 1536 * 1024 * 1024;
export const MAX_HEADER = 2 * 1024 * 1024;
export const AUDIO_TYPES = new Set(['audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/aac']);
export const typeForName = name => ({mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',aac:'audio/aac'})[name.split('.').pop().toLowerCase()];
export const bytesLabel = n => n < 1024*1024 ? `${Math.round(n/1024)} Ko` : n < 1024**3 ? `${(n/1024**2).toFixed(n < 10*1024**2 ? 1 : 0)} Mo` : `${(n/1024**3).toFixed(2)} Go`;
export const timeLabel = s => !Number.isFinite(s) ? '0:00' : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const validText = (s, max=240) => typeof s==='string' && s.length>0 && s.length<=max;
export async function contentId(blob) {
  const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  return 't-'+Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
export function validateManifest(m, payloadSize) {
  if (!m || m.version!==1 || !Array.isArray(m.tracks) || !Array.isArray(m.playlists) || m.tracks.length>10000 || m.playlists.length>500) throw Error('Sauvegarde Sillage non reconnue.');
  const ids=new Set(); let total=0;
  for(const t of m.tracks){
    if(!t || !/^t-[a-f0-9]{64}$/.test(t.id) || ids.has(t.id) || !validText(t.title) || typeof t.artist!=='string' || t.artist.length>240 || !AUDIO_TYPES.has(t.type) || !Number.isSafeInteger(t.size) || t.size<=0 || t.size>MAX_TRACK || !Number.isFinite(t.duration) || t.duration<0 || t.duration>86400) throw Error('La sauvegarde contient un morceau invalide.');
    ids.add(t.id);total+=t.size;
  }
  if(total!==payloadSize || total>MAX_PACK) throw Error('La sauvegarde est incomplète ou trop volumineuse.');
  const pids=new Set();
  for(const p of m.playlists){
    if(!p || !validText(p.id,100) || pids.has(p.id) || !validText(p.name,80) || !Array.isArray(p.trackIds) || p.trackIds.length>10000 || p.trackIds.some(id=>!ids.has(id)) || new Set(p.trackIds).size!==p.trackIds.length) throw Error('La sauvegarde contient une playlist invalide.');
    pids.add(p.id);
  }
  return m;
}
export function encodePack(manifest, blobs) {
  if(blobs.length!==manifest.tracks.length || blobs.some((b,i)=>b.size!==manifest.tracks[i].size)) throw Error('Fichier audio manquant.');
  validateManifest(manifest,blobs.reduce((s,b)=>s+b.size,0));
  const h=new TextEncoder().encode(JSON.stringify(manifest));
  if(h.length>MAX_HEADER) throw Error('Trop de métadonnées dans la sauvegarde.');
  const len=new Uint8Array(4);new DataView(len.buffer).setUint32(0,h.length,true);
  return new Blob([MAGIC,len,h,...blobs],{type:'application/octet-stream'});
}
export async function decodePack(blob) {
  if(blob.size>MAX_PACK+MAX_HEADER+13) throw Error('La sauvegarde dépasse 1,5 Go. Exportez une playlist à la fois.');
  const prefix=new Uint8Array(await blob.slice(0,13).arrayBuffer());
  if(prefix.length!==13 || MAGIC.some((v,i)=>prefix[i]!==v)) throw Error('Ce fichier n’est pas une sauvegarde Sillage.');
  const n=new DataView(prefix.buffer).getUint32(9,true);
  if(n===0 || n>MAX_HEADER || 13+n>blob.size) throw Error('En-tête de sauvegarde invalide.');
  let manifest;try{manifest=JSON.parse(await blob.slice(13,13+n).text());}catch{throw Error('En-tête de sauvegarde illisible.');}
  validateManifest(manifest,blob.size-13-n);
  let offset=13+n;
  const entries=manifest.tracks.map(t=>{const audio=blob.slice(offset,offset+t.size,t.type);offset+=t.size;return {track:t,blob:audio};});
  return {manifest,entries};
}
