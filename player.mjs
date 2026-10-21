import {getBlob} from './db.mjs';
export class Player extends EventTarget {
  constructor(audio){
    super();this.audio=audio;this.tracks=new Map();this.queue=[];this.index=-1;this.mode='off';this.shuffle=false;this.urls=new Map();this.serial=0;
    for(const event of ['play','pause','timeupdate','durationchange','loadedmetadata'])audio.addEventListener(event,()=>{this.position();this.emit();});
    audio.addEventListener('ended',()=>this.next(true));
    audio.addEventListener('error',()=>this.error('Ce fichier audio ne peut pas être lu. Essayez une version MP3.'));
    if('audioSession' in navigator){try{navigator.audioSession.type='playback';}catch{}}
    if('mediaSession' in navigator){
      const handlers={play:()=>this.resume(),pause:()=>audio.pause(),previoustrack:()=>this.previous(),nexttrack:()=>this.next(),seekto:d=>{if(Number.isFinite(d.seekTime))audio.currentTime=d.seekTime;},seekbackward:d=>{audio.currentTime=Math.max(0,audio.currentTime-(d.seekOffset||10));},seekforward:d=>{audio.currentTime=Math.min(audio.duration||0,audio.currentTime+(d.seekOffset||10));}};
      for(const [name,fn] of Object.entries(handlers)){try{navigator.mediaSession.setActionHandler(name,fn);}catch{}}
    }
  }
  get current(){return this.tracks.get(this.queue[this.index]);}
  setTracks(tracks){this.tracks=new Map(tracks.map(t=>[t.id,t]));const currentId=this.queue[this.index];this.queue=this.queue.filter(id=>this.tracks.has(id));this.index=this.queue.indexOf(currentId);if(currentId && this.index<0)this.stop();}
  emit(){this.dispatchEvent(new Event('change'));}
  error(message){this.dispatchEvent(new CustomEvent('playererror',{detail:message}));}
  async url(id){if(this.urls.has(id))return this.urls.get(id);const b=await getBlob(id);if(!b)throw Error('Fichier introuvable. Réimportez votre sauvegarde.');const u=URL.createObjectURL(b);if(this.urls.has(id)){URL.revokeObjectURL(u);return this.urls.get(id);}this.urls.set(id,u);return u;}
  async playList(ids,start=0){this.queue=ids.filter(id=>this.tracks.has(id));this.index=start;if(!this.queue.length)return;await this.load();}
  async load(){
    const token=++this.serial,track=this.current;if(!track)return;
    try{const url=await this.url(track.id);if(token!==this.serial)return;this.audio.src=url;this.audio.load();this.metadata();await this.resume();this.prefetch();}catch(e){this.error(e.message);}
    this.emit();
  }
  async resume(){try{await this.audio.play();}catch{this.error('Touchez Lecture pour reprendre le son. iOS a peut-être suspendu la lecture.');}this.emit();}
  toggle(){if(!this.current){this.error('Choisissez d’abord un morceau.');return;}if(this.audio.paused)this.resume();else this.audio.pause();}
  next(ended=false){
    if(!this.queue.length)return;
    if(ended && this.mode==='one'){this.audio.currentTime=0;this.resume();return;}
    if(this.shuffle && this.queue.length>1){let i=this.index;while(i===this.index)i=Math.floor(Math.random()*this.queue.length);this.index=i;}
    else if(this.index+1<this.queue.length)this.index++;
    else if(this.mode==='all' || !ended)this.index=0;
    else {this.emit();return;}
    this.load();
  }
  previous(){if(this.audio.currentTime>3){this.audio.currentTime=0;return;}if(this.queue.length){this.index=(this.index-1+this.queue.length)%this.queue.length;this.load();}}
  stop(){++this.serial;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.queue=[];this.index=-1;for(const u of this.urls.values())URL.revokeObjectURL(u);this.urls.clear();if('mediaSession' in navigator){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}this.emit();}
  async prefetch(){
    const keep=new Set([this.queue[this.index],this.queue[(this.index+1)%this.queue.length]]);
    for(const [id,url] of this.urls){if(!keep.has(id)){URL.revokeObjectURL(url);this.urls.delete(id);}}
    const id=this.queue[(this.index+1)%this.queue.length];if(id)try{await this.url(id);}catch{}
  }
  metadata(){const t=this.current;if(t && 'mediaSession' in navigator && 'MediaMetadata' in window){navigator.mediaSession.metadata=new MediaMetadata({title:t.title,artist:t.artist||'Bibliothèque personnelle',album:'Sillage',artwork:[{src:new URL('./icon-512.png',import.meta.url).href,sizes:'512x512',type:'image/png'}]});}}
  position(){if(!('mediaSession' in navigator))return;navigator.mediaSession.playbackState=this.current?(this.audio.paused?'paused':'playing'):'none';if(Number.isFinite(this.audio.duration) && this.audio.duration>0 && navigator.mediaSession.setPositionState){try{navigator.mediaSession.setPositionState({duration:this.audio.duration,playbackRate:this.audio.playbackRate,position:Math.min(this.audio.duration,Math.max(0,this.audio.currentTime))});}catch{}}}
}
