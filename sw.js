const CACHE='sillage-shell-v1.3.3';
const ASSETS=['./','./index.html','./style.css','./app.js','./format.mjs','./db.mjs','./player.mjs','./sync.mjs','./sync-panel.mjs','./sync-protocol.mjs','./https-sync.mjs','./relay-discovery.mjs','./peer-loader.mjs','./profile.mjs','./spotify-links.mjs','./youtube.mjs','./companion.mjs','./bridge-api.mjs','./qrcode.js','./peerjs.min.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(ASSETS.filter(path=>!(['127.0.0.1','localhost'].includes(self.location.hostname) && path==='./bridge-api.mjs')));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys()){if(key.startsWith('sillage-shell-') && key!==CACHE)await caches.delete(key);}await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),base=new URL(self.registration.scope);
  if(event.request.method!=='GET' || url.origin!==base.origin || !url.pathname.startsWith(base.pathname) || url.pathname.includes('/api/') || (['127.0.0.1','localhost'].includes(url.hostname) && url.pathname.endsWith('/bridge-api.mjs')) || /\/bridge\.(html|mjs)$/.test(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate'){
      // Local app data lives in IndexedDB. The cached shell is sufficient offline.
      const cached=await cache.match(new URL('./index.html',base).href);if(cached)return cached;
      return fetch(event.request);
    }
    return await cache.match(event.request,{ignoreSearch:true}) || fetch(event.request);
  })());
});
