import {AudioPlaybackController} from '../../src/character-chat/AudioPlaybackController'
const w=window as any,api=w.dotQaBridge,telemetry:any[]=[]
w.dotQa={telemetry,frame:null,failNextAudio:false}
const Native=window.AudioContext
class Observed extends Native{
 async decodeAudioData(bytes:ArrayBuffer,...args:any[]):Promise<AudioBuffer>{const audio=await super.decodeAudioData(bytes,...args);let peak=0;for(const v of audio.getChannelData(0))peak=Math.max(peak,Math.abs(v));telemetry.push({type:'decoded',at:Date.now(),samples:audio.length,sampleRate:audio.sampleRate,channels:audio.numberOfChannels,peak});return audio}
 createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source),stop=source.stop.bind(source);source.start=(...args)=>{telemetry.push({type:'start',at:Date.now(),when:args[0],state:this.state});start(...args)};source.stop=(...args)=>{telemetry.push({type:'stop',at:Date.now()});stop(...args)};source.addEventListener('ended',()=>telemetry.push({type:'ended',at:Date.now()}));return source}
}
const player=new AudioPlaybackController(api,()=>new Observed({sampleRate:48000}))
api.frames((frame:any)=>{w.dotQa.frame=frame;document.getElementById('message')!.textContent=frame?.text||frame?.voicePhase||'Idle'})
api.volumes((volume:number)=>player.setVolume(volume))
api.events((event:any)=>{telemetry.push({type:'event',at:Date.now(),event});if(event.type==='audio'&&w.dotQa.failNextAudio){w.dotQa.failNextAudio=false;void api.audio(event.audioId,event.epoch).then(()=>api.action({type:'played',audioId:event.audioId,epoch:event.epoch,error:true}));return}void player.receive(event)})
document.addEventListener('visibilitychange',()=>player.setVisible(!document.hidden))
void api.volume().then((v:number)=>{player.setVolume(v);player.setVisible(!document.hidden);return api.ready()})
