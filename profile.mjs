import {normalizeCode, sourceId} from './sync-protocol.mjs';

export const PUBLIC_APP='https://nostranojojosus.github.io/sillage-musique/';
export async function profileId(code) {
  const hash=(await sourceId(code)).slice(8,20).toUpperCase();
  return 'SLG-'+hash.match(/.{4}/g).join('-');
}
export function profileName(value) {
  return String(value||'Mon espace').trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,60)||'Mon espace';
}
export function invitation(code) {
  return PUBLIC_APP+'#profil='+normalizeCode(code);
}
export function readInvitation(value) {
  const input=String(value||'').trim();
  if(input.startsWith('https://')) {
    const u=new URL(input),expected=new URL(PUBLIC_APP);
    if(u.origin!==expected.origin || u.pathname!==expected.pathname || u.username || u.password)throw Error('Utilisez le lien privé créé par Sillage.');
    return normalizeCode(new URLSearchParams(u.hash.slice(1)).get('profil')||'');
  }
  if(/^SLG-/i.test(input))throw Error('Cet ID identifie le profil. Pour y accéder, utilisez sa clé privée ou son lien d’association.');
  return normalizeCode(input);
}

let qrScript;
export async function renderProfileQR(element,code) {
  if(!window.qrcode) {
    if(!qrScript)qrScript=new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src=new URL('./qrcode.js',import.meta.url).href;
      s.onload=resolve;s.onerror=()=>{qrScript=null;s.remove();reject(Error('QR indisponible ; utilisez le lien ou la clé privée.'));};document.head.append(s);
    });
    await qrScript;
  }
  if(!element.isConnected)return;
  const qr=window.qrcode(0,'M');qr.addData(invitation(code));qr.make();
  element.innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});
  element.querySelector('svg').setAttribute('aria-label','QR privé pour associer ce profil');
}
