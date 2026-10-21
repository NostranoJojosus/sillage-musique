import {contentId, MAX_HEADER, MAX_TRACK} from './format.mjs';
import {catalogOf, validateCatalog, normalizeCode, SyncFault} from './sync-protocol.mjs';

export const HTTPS_CHUNK = 256 * 1024;
const FRAME_OVERHEAD = 12 + 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const cancelled = () => new DOMException('Synchronisation arrêtée.', 'AbortError');

// Validate the original spelling too: URL() alone accepts credentials, ports,
// backslashes and whitespace that must never receive the access token.
export function normalizeRelayUrl(value) {
  const match = typeof value === 'string' && /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com\/?$/.exec(value);
  if (!match || match[0] !== value) throw new SyncFault('Le lien de connexion au PC est invalide.', 'address');
  return value.replace(/\/$/, '');
}

export async function deriveHttpsSecrets(code) {
  const normalized = normalizeCode(code);
  const accessToken = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('sillage-https-access-v1:' + normalized))));
  const material = await crypto.subtle.importKey('raw', Uint8Array.from(normalized.match(/../g), n => parseInt(n, 16)), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:encoder.encode('sillage-https-v1'), info:encoder.encode('encryption')}, material, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
  return {accessToken, key};
}

export async function encryptFrame(key, data, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encoder.encode(context)}, key, data));
  const frame = new Uint8Array(iv.length + encrypted.length);
  frame.set(iv); frame.set(encrypted, iv.length);
  return frame;
}

export async function decryptFrame(key, frame, context) {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.length < FRAME_OVERHEAD) throw new SyncFault('Données chiffrées incomplètes.', 'integrity');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes.subarray(0, 12), additionalData:encoder.encode(context)}, key, bytes.subarray(12)));
  } catch {
    throw new SyncFault('La clé ne correspond pas ou les données reçues sont endommagées. Scannez à nouveau le lien du PC.', 'integrity');
  }
}

function base64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}

function catalogBytes(catalog) {
  const data = encoder.encode(JSON.stringify(catalog));
  if (data.length > MAX_HEADER) throw new SyncFault('La liste de morceaux est trop volumineuse.');
  return data;
}

function fault(error) {
  if (error?.name === 'QuotaExceededError') return new SyncFault('L’iPhone manque de place. Libérez du stockage puis réessayez.', 'storage');
  return error instanceof Error ? error : new SyncFault('La synchronisation a été interrompue.');
}

export class HttpsSync {
  constructor({store, companion, discovery, onState = () => {}, onUrl = () => {}, fetch:fetcher = globalThis.fetch.bind(globalThis), pollMs = 10000, requestTimeout = 30000, prepareTimeout = 60000, preparePollMs = 1000, discoveryTimeout = 10000}) {
    this.store = store; this.companion = companion; this.discovery = discovery; this.onState = onState; this.onUrl = onUrl;
    this.fetch = fetcher; this.pollMs = pollMs; this.requestTimeout = requestTimeout;
    this.prepareTimeout = prepareTimeout; this.preparePollMs = preparePollMs; this.discoveryTimeout = discoveryTimeout; this.run = null;
  }

  current(run) { return this.run === run && !run.controller.signal.aborted; }
  check(run) { if (!this.current(run)) throw cancelled(); }
  state(run, text, kind = 'waiting', extra = {}) { if (this.current(run)) this.onState({text, kind, ...extra}); }

  stop() {
    const run = this.run; this.run = null;
    if (run) { clearTimeout(run.timer); run.controller.abort(); }
    this.discovery?.stop();
  }

  async start({role, code, url}) {
    this.stop();
    if (!['source', 'receiver'].includes(role)) throw new SyncFault('Rôle de synchronisation invalide.');
    // Invalid destinations fail before deriving or exposing any token.
    const address = role === 'receiver' ? (url === undefined && this.discovery ? null : normalizeRelayUrl(url)) : null;
    const run = {role, code:normalizeCode(code), url:address, controller:new AbortController(), uploaded:new Map(), catalog:null, ready:false, needsPrepare:role === 'source', needsResolve:role === 'receiver', discoveryStarted:false};
    this.run = run;
    this.state(run, role === 'source' ? 'Préparation du lien HTTPS…' : 'Connexion sécurisée au PC…');
    try {
      Object.assign(run, await deriveHttpsSecrets(code)); this.check(run);
      run.ready = true;
      await this.syncOnce();
    } catch (error) {
      if (!this.current(run)) { if (run.failure) throw run.failure; return; }
      error = fault(error);
      this.stop(); this.onState({text:error.message, kind:'error', reason:error.kind}); throw error;
    }
  }

  // One operation at a time, including explicit refreshes and scheduled polls.
  syncOnce() {
    const run = this.run;
    if (!run || !run.ready) return Promise.resolve();
    if (run.busy) return run.busy;
    clearTimeout(run.timer);
    run.busy = (run.role === 'source' ? this.publish(run) : this.receive(run)).catch(error => {
      if (!this.current(run)) return;
      error = fault(error);
      if (error.kind === 'network') {
        if (run.role === 'source') run.needsPrepare = true;
        else run.needsResolve = true;
        this.state(run, error.message + ' Nouvelle tentative automatique.');
        return;
      }
      run.failure = error;
      this.stop(); this.onState({text:error.message, kind:'error', reason:error.kind}); throw error;
    }).finally(() => {
      run.busy = null;
      if (this.current(run)) this.schedule(run);
    });
    return run.busy;
  }

  schedule(run) {
    clearTimeout(run.timer);
    run.timer = setTimeout(() => {
      if (this.current(run)) this.syncOnce().catch(() => {});
    }, this.pollMs);
    run.timer.unref?.();
  }

  async pause(run, delay) {
    this.check(run);
    await new Promise((resolve, reject) => {
      const signal = run.controller.signal;
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(cancelled()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
      signal.addEventListener('abort', abort, {once:true});
    });
    this.check(run);
  }

  async local(run, method, args = {}, timeout = this.requestTimeout) {
    this.check(run);
    if (!this.companion?.call) throw new SyncFault('Démarrez Sillage sur le PC pour préparer le lien HTTPS.', 'network');
    const signal = run.controller.signal;
    let timer, abort;
    try {
      const result = await Promise.race([
        this.companion.call(method, args),
        new Promise((_, reject) => {
          abort = () => reject(cancelled());
          signal.addEventListener('abort', abort, {once:true});
          timer = setTimeout(() => reject(new SyncFault('Le convertisseur PC ne répond pas. Relancez Demarrer-Sillage.cmd.', 'network')), timeout);
        })
      ]);
      this.check(run); return result;
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
  }

  async discoveryCall(run, operation) {
    this.check(run);
    let timer, abort;
    const signal = run.controller.signal;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => { this.check(run); return operation(); }),
        new Promise((_, reject) => {
          abort = () => reject(cancelled()); signal.addEventListener('abort', abort, {once:true});
          timer = setTimeout(() => reject(new SyncFault('La recherche du PC est momentanément indisponible.', 'network')), this.discoveryTimeout);
        })
      ]);
      this.check(run); return result;
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
  }

  async openDiscovery(run) {
    if (!this.discovery || run.discoveryStarted) return;
    try {
      await this.discoveryCall(run, () => this.discovery.start({role:run.role, code:run.code}));
      run.discoveryStarted = true;
    } catch (error) {
      this.check(run);
      if (error?.kind && error.kind !== 'network') throw error;
      // The saved HTTPS address remains usable while discovery is unavailable.
    }
  }

  async resolveAddress(run) {
    await this.openDiscovery(run); this.check(run);
    let address = null;
    if (run.discoveryStarted) {
      try { address = await this.discoveryCall(run, () => this.discovery.resolve()); }
      catch (error) {
        this.check(run);
        if (error?.kind && error.kind !== 'network') throw error;
      }
    }
    if (address !== null && address !== undefined) {
      const normalized = normalizeRelayUrl(address);
      if (normalized !== run.url) { run.url = normalized; this.onUrl(normalized); }
    }
    run.needsResolve = false;
    if (!run.url) throw new SyncFault('En attente de votre PC. Ouvrez Sillage dans votre navigateur habituel sur le PC.', 'network');
  }

  async prepare(run) {
    const deadline = Date.now() + this.prepareTimeout;
    let status = await this.local(run, 'sync-prepare', {accessToken:run.accessToken}, Math.min(this.requestTimeout, this.prepareTimeout));
    while (!status?.ready || !status.url) {
      if (status?.available === false || status?.error || (!status?.starting && !status?.ready)) throw new SyncFault(status?.message || 'Le lien HTTPS n’a pas démarré sur le PC.', 'network');
      if (Date.now() >= deadline) throw new SyncFault('Le lien HTTPS met trop de temps à démarrer. Relancez la connexion.', 'network');
      await this.pause(run, Math.min(this.preparePollMs, deadline - Date.now()));
      status = await this.local(run, 'sync-status', {}, Math.min(this.requestTimeout, Math.max(1, deadline - Date.now())));
    }
    this.acceptStatus(run, status);
    run.needsPrepare = false;
  }

  acceptStatus(run, status) {
    if (!status?.ready || status?.available === false || !/^[a-f0-9]{32}$/.test(status?.session || '')) throw new SyncFault(status?.message || 'Le lien HTTPS du PC est fermé. Relancez la connexion.', 'network');
    const url = normalizeRelayUrl(status.url);
    if (run.session !== status.session) { run.uploaded.clear(); run.catalog = null; }
    const changed = run.url !== url;
    run.session = status.session; run.url = url;
    if (changed) this.onUrl(url);
  }

  async put(run, kind, id, index, bytes) {
    this.check(run);
    await this.local(run, 'sync-put', {kind, id, index, data:base64(bytes), session:run.session});
  }

  async publish(run) {
    if (run.needsPrepare || !run.session) await this.prepare(run);
    else {
      const status = await this.local(run, 'sync-status');
      if (!status?.ready || status.session !== run.session || status.url !== run.url) await this.prepare(run);
      else this.acceptStatus(run, status);
    }
    const catalog = catalogOf(await this.store.getLibrary()); this.check(run);
    const bytes = catalogBytes(catalog);
    for (const track of catalog.tracks) {
      if (run.uploaded.get(track.id) === track.size) continue;
      const blob = await this.store.getBlob(track.id); this.check(run);
      if (!(blob instanceof Blob) || blob.size !== track.size || blob.size > MAX_TRACK) throw new SyncFault('Un fichier audio manque sur le PC. Réimportez ce morceau.', 'integrity');
      if (await contentId(blob) !== track.id) throw new SyncFault('Un fichier audio du PC est endommagé. Réimportez ce morceau.', 'integrity');
      this.check(run);
      for (let offset = 0, index = 0; offset < blob.size; offset += HTTPS_CHUNK, index++) {
        const chunk = await blob.slice(offset, offset + HTTPS_CHUNK).arrayBuffer(); this.check(run);
        const frame = await encryptFrame(run.key, chunk, `audio:${track.id}:${index}`); this.check(run);
        await this.put(run, 'audio', track.id, index, frame);
        this.state(run, 'Préparation de la musique pour l’iPhone…', 'copying', {progress:Math.min(1, (offset + chunk.byteLength) / blob.size)});
      }
      run.uploaded.set(track.id, track.size);
    }
    const fingerprint = decoder.decode(bytes);
    if (run.catalog !== fingerprint) {
      const frame = await encryptFrame(run.key, bytes, 'catalog'); this.check(run);
      await this.put(run, 'catalog', '', 0, frame);
      run.catalog = fingerprint;
    }
    await this.openDiscovery(run); this.check(run);
    if (run.discoveryStarted) {
      try { this.discovery.advertise(run.url); }
      catch (error) {
        if (error?.kind && error.kind !== 'network') throw error;
        run.discoveryStarted = false;
      }
    }
    this.state(run, 'PC prêt · lien HTTPS', 'ready', {done:true});
  }

  async download(run, path, maxBytes) {
    this.check(run);
    // Revalidate immediately before attaching credentials; paths are internal.
    const address = normalizeRelayUrl(run.url);
    const controller = new AbortController();
    const abort = () => controller.abort();
    run.controller.signal.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(abort, this.requestTimeout);
    let reader;
    try {
      const response = await this.fetch(address + path, {headers:{Authorization:'Bearer ' + run.accessToken}, cache:'no-store', redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal});
      this.check(run);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new SyncFault('La clé n’est plus reconnue. Ouvrez le nouveau lien affiché sur le PC.', 'auth');
        throw new SyncFault(response.status === 404 ? 'La musique n’est pas encore prête sur le PC.' : 'Le PC est momentanément injoignable.', 'network');
      }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new SyncFault('Le PC a envoyé un fichier trop volumineux.', 'integrity');
      let bytes;
      if (response.body?.getReader) {
        reader = response.body.getReader(); const parts = []; let length = 0;
        while (true) {
          const {done, value} = await reader.read(); this.check(run);
          if (done) break;
          length += value.byteLength;
          if (length > maxBytes) throw new SyncFault('Le PC a envoyé un fichier trop volumineux.', 'integrity');
          parts.push(value);
        }
        bytes = new Uint8Array(length); let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      } else {
        bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > maxBytes) throw new SyncFault('Le PC a envoyé un fichier trop volumineux.', 'integrity');
      }
      this.check(run); return bytes;
    } catch (error) {
      if (!this.current(run)) throw cancelled();
      if (error instanceof SyncFault) throw error;
      throw new SyncFault('Le PC est momentanément injoignable. Gardez Sillage ouvert sur le PC.', 'network');
    } finally {
      clearTimeout(timer); run.controller.signal.removeEventListener('abort', abort);
      controller.abort();
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    }
  }

  async receive(run) {
    if (run.needsResolve || !run.url) await this.resolveAddress(run);
    const frame = await this.download(run, '/v1/catalog', MAX_HEADER + FRAME_OVERHEAD);
    const bytes = await decryptFrame(run.key, frame, 'catalog'); this.check(run);
    if (bytes.length > MAX_HEADER) throw new SyncFault('La liste de morceaux est trop volumineuse.');
    let catalog, fingerprint;
    try { fingerprint = decoder.decode(bytes); catalog = validateCatalog(JSON.parse(fingerprint)); }
    catch { throw new SyncFault('La liste des morceaux reçue est invalide.', 'integrity'); }
    const library = await this.store.getLibrary(); this.check(run);
    const present = new Set(library.tracks.map(track => track.id));
    const missing = catalog.tracks.filter(track => !present.has(track.id));
    if (missing.length) {
      await this.store.checkSpace?.(missing.reduce((total, track) => total + track.size, 0)); this.check(run);
    }
    for (let position = 0; position < missing.length; position++) {
      const track = missing[position], chunks = [];
      for (let index = 0, offset = 0; offset < track.size; index++, offset += HTTPS_CHUNK) {
        const size = Math.min(HTTPS_CHUNK, track.size - offset);
        const encrypted = await this.download(run, `/v1/audio/${track.id}/${index}`, size + FRAME_OVERHEAD);
        const chunk = await decryptFrame(run.key, encrypted, `audio:${track.id}:${index}`); this.check(run);
        if (chunk.length !== size) throw new SyncFault('Un morceau est incomplet. Aucun fragment n’a été enregistré.', 'integrity');
        chunks.push(chunk);
        this.state(run, `Copie ${position + 1}/${missing.length} · ${track.title}`, 'copying', {progress:(position + (offset + size) / track.size) / missing.length});
      }
      const blob = new Blob(chunks, {type:track.type});
      if (await contentId(blob) !== track.id) throw new SyncFault('Un morceau reçu est endommagé. Il n’a pas été enregistré.', 'integrity');
      this.check(run);
      await this.store.commitImport([{track:{...track, addedAt:Date.now()}, blob}], []); this.check(run);
      await this.store.onSaved?.(); this.check(run);
    }
    if (run.catalog !== fingerprint || missing.length) {
      await this.store.applyMetadata(catalog); this.check(run);
      await this.store.onSaved?.(); this.check(run);
      run.catalog = fingerprint;
    }
    this.state(run, 'À jour · musique disponible même sans le PC', 'ready', {done:true});
  }
}
