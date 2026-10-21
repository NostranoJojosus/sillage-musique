import {normalizeCode, newCode} from './sync-protocol.mjs';
import {normalizeRelayUrl} from './https-sync.mjs';

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', {fatal:true});
const LABEL = 'sillage-relay-discovery-v1', MAX_META = 2048;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export async function discoverySecrets(code) {
  const normalized = normalizeCode(code);
  const id = 'sillage-discovery-' + hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('sillage-relay-topic-v1:' + normalized))));
  const material = await crypto.subtle.importKey('raw', Uint8Array.from(normalized.match(/../g), n => parseInt(n, 16)), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:enc.encode(LABEL), info:enc.encode('encryption')}, material, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
  return {id, key};
}
export async function sealDiscovery(key, kind, body) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:enc.encode(LABEL + ':' + kind)}, key, enc.encode(JSON.stringify(body))));
  const frame = new Uint8Array(12 + cipher.length); frame.set(iv); frame.set(cipher, 12);
  const data = btoa(String.fromCharCode(...frame));
  if (data.length > MAX_META) throw Error('Message de découverte trop volumineux.');
  return {v:1, kind, data};
}
export async function openDiscovery(key, metadata, kind) {
  if (!metadata || Object.keys(metadata).length !== 3 || metadata.v !== 1 || metadata.kind !== kind || typeof metadata.data !== 'string' || metadata.data.length > MAX_META || !/^[A-Za-z0-9+/]+={0,2}$/.test(metadata.data)) throw Error('Message de découverte invalide.');
  const frame = Uint8Array.from(atob(metadata.data), c => c.charCodeAt(0));
  if (frame.length < 29) throw Error('Message de découverte incomplet.');
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:frame.subarray(0, 12), additionalData:enc.encode(LABEL + ':' + kind)}, key, frame.subarray(12));
  return JSON.parse(dec.decode(plain));
}

// Only encrypted OFFER metadata crosses the existing signalling service.
// No ICE server, usable candidate, DataChannel message or audio is needed.
export class RelayDiscovery {
  constructor({loadPeer, timeoutMs = 10000, reconnectMs = 5000, connectionMs = 2500} = {}) {
    this.loadPeer = loadPeer; this.timeoutMs = timeoutMs; this.reconnectMs = reconnectMs; this.connectionMs = connectionMs;
    this.run = null;
  }
  current(run) { return this.run === run; }
  later(run, fn, ms) {
    const timer = setTimeout(() => { run.timers.delete(timer); if (this.current(run)) fn(); }, ms);
    timer.unref?.(); run.timers.add(timer); return timer;
  }
  async start({role, code}) {
    this.stop();
    if (!['source', 'receiver'].includes(role) || typeof this.loadPeer !== 'function') throw Error('Découverte indisponible.');
    const run = {role, timers:new Set(), connections:new Map(), seen:new Map(), arrivals:[], url:null, peer:null, pending:null, retries:0};
    this.run = run;
    try { Object.assign(run, await discoverySecrets(code)); }
    catch (error) { if (this.current(run)) this.stop(); throw error; }
    if (this.current(run)) this.connect(run);
  }
  advertise(url) {
    if (this.run?.role !== 'source') return;
    this.run.url = url ? normalizeRelayUrl(url) : null;
  }
  stop() {
    const run = this.run; this.run = null; if (!run) return;
    for (const timer of run.timers) clearTimeout(timer);
    run.timers.clear(); run.pending?.finish(null);
    for (const connection of [...run.connections.keys()]) { try { connection.close(); } catch {} }
    run.connections.clear(); try { run.peer?.destroy(); } catch {}
  }
  connect(run) {
    if (!this.current(run) || run.loading || run.peer) return;
    run.loading = true;
    let expired = false;
    const deadline = this.later(run, () => { expired = true; run.loading = false; this.retry(run); }, 8000);
    Promise.resolve().then(() => this.loadPeer()).then(Peer => {
      if (!this.current(run) || expired) return;
      clearTimeout(deadline); run.timers.delete(deadline); run.loading = false;
      const peer = new Peer(run.role === 'source' ? run.id : 'sillage-find-' + newCode(), {
        host:'0.peerjs.com', port:443, path:'/', secure:true, key:'peerjs', debug:0,
        config:{iceServers:[], iceTransportPolicy:'relay'}
      });
      run.peer = peer;
      const current = () => this.current(run) && run.peer === peer;
      const opening = this.later(run, () => { if (current() && !peer.open) this.retry(run); }, 15000);
      peer.on('open', () => { if (!current()) return; clearTimeout(opening); run.timers.delete(opening); run.retries = 0; if (run.pending) this.attempt(run, run.pending); });
      peer.on('connection', connection => { if (!current()) { connection.close(); return; } this.incoming(run, connection).catch(() => {}); });
      peer.on('call', call => call.close());
      peer.on('disconnected', () => { if (current()) this.retry(run); });
      peer.on('close', () => { if (current()) this.retry(run); });
      peer.on('error', error => {
        if (!current()) return;
        // Closing metadata-only offers can end their unused negotiation.
        if (['webrtc', 'peer-unavailable'].includes(error?.type)) return;
        this.retry(run);
      });
    }).catch(() => {
      if (!this.current(run) || expired) return;
      clearTimeout(deadline); run.timers.delete(deadline); run.loading = false; this.retry(run);
    });
  }
  retry(run) {
    if (!this.current(run) || run.retryTimer) return;
    const peer = run.peer; run.peer = null;
    for (const connection of [...run.connections.keys()]) this.closeConnection(run, connection);
    try { peer?.destroy(); } catch {}
    run.retryTimer = this.later(run, () => { run.retryTimer = null; this.connect(run); }, Math.min(30000, this.reconnectMs * ++run.retries));
  }
  closeConnection(run, connection) {
    const timer = run.connections.get(connection);
    clearTimeout(timer); run.timers.delete(timer); run.connections.delete(connection);
    try { connection.close(); } catch {}
  }
  track(run, connection) {
    if (!connection || !this.current(run) || run.connections.size >= 8) { try { connection?.close(); } catch {} return false; }
    const timer = this.later(run, () => this.closeConnection(run, connection), this.connectionMs);
    run.connections.set(connection, timer);
    connection.on('open', () => this.closeConnection(run, connection));
    connection.on('error', () => this.closeConnection(run, connection));
    connection.on('close', () => { clearTimeout(timer); run.timers.delete(timer); run.connections.delete(connection); });
    return true;
  }
  resolve() {
    const run = this.run;
    if (!run || run.role !== 'receiver') return Promise.resolve(null);
    if (run.pending) return run.pending.promise;
    const pending = {nonces:new Set(), attempts:0, timers:new Set(), sending:false};
    pending.promise = new Promise(resolve => { pending.finish = value => {
      if (pending.finished) return; pending.finished = true;
      for (const timer of pending.timers) { clearTimeout(timer); run.timers.delete(timer); }
      if (run.pending === pending) run.pending = null;
      resolve(value);
    }; });
    run.pending = pending;
    pending.timers.add(this.later(run, () => pending.finish(null), this.timeoutMs));
    for (const fraction of [0, 0.3, 0.65]) pending.timers.add(this.later(run, () => this.attempt(run, pending), Math.floor(this.timeoutMs * fraction)));
    return pending.promise;
  }
  async attempt(run, pending) {
    if (!this.current(run) || run.pending !== pending || pending.finished || pending.sending || pending.attempts >= 3 || !run.peer?.open) return;
    pending.sending = true; pending.attempts++;
    const peer = run.peer, nonce = newCode(); pending.nonces.add(nonce);
    try {
      const metadata = await sealDiscovery(run.key, 'request', {v:1, from:peer.id, to:run.id, nonce, issued:Date.now()});
      if (!this.current(run) || run.pending !== pending || run.peer !== peer || !peer.open) return;
      this.track(run, peer.connect(run.id, {serialization:'raw', reliable:false, label:LABEL, metadata}));
    } catch {} finally { pending.sending = false; }
  }
  async incoming(run, connection) {
    const now = Date.now();
    run.arrivals = run.arrivals.filter(time => now - time < 60000);
    if (run.arrivals.length >= 30 || !this.track(run, connection)) { try { connection.close(); } catch {} return; }
    run.arrivals.push(now);
    const peer = run.peer, kind = run.role === 'source' ? 'request' : 'reply';
    if (connection.label !== LABEL) return this.closeConnection(run, connection);
    let body;
    try { body = await openDiscovery(run.key, connection.metadata, kind); }
    catch { return this.closeConnection(run, connection); }
    if (!this.current(run) || run.peer !== peer || !body || body.v !== 1 || body.from !== connection.peer || body.to !== peer.id || !/^[a-f0-9]{32}$/.test(body.nonce || '') || !Number.isSafeInteger(body.issued) || Math.abs(Date.now() - body.issued) > 60000) return this.closeConnection(run, connection);
    if (run.role === 'receiver') {
      const pending = run.pending;
      if (connection.peer !== run.id || !pending?.nonces.has(body.nonce) || !Number.isSafeInteger(body.expires) || body.expires < Date.now() || body.expires > Date.now() + 120000) return;
      let url; try { url = normalizeRelayUrl(body.url); } catch { return; }
      pending.finish(url); return;
    }
    if (!run.url) return;
    for (const [key, time] of run.seen) if (now - time > 60000) run.seen.delete(key);
    const replayKey = body.from + ':' + body.nonce;
    if (run.seen.has(replayKey) || run.seen.size >= 64) return;
    run.seen.set(replayKey, now);
    const url = run.url;
    const metadata = await sealDiscovery(run.key, 'reply', {v:1, from:peer.id, to:body.from, nonce:body.nonce, issued:Date.now(), expires:Date.now() + 60000, url});
    if (!this.current(run) || run.peer !== peer || !peer.open || run.url !== url) return;
    this.track(run, peer.connect(body.from, {serialization:'raw', reliable:false, label:LABEL, metadata}));
  }
}
