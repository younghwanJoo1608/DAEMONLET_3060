import {createRoot} from 'react-dom/client'
import {useEffect,useState} from 'react'
import {VoiceControls,VoiceSettings} from '../../src/character-chat/VoiceControls'
import type {VoiceSnapshot,VoiceAction} from '../../electron/shared/character-voice-contract'
import {AudioPlaybackController} from '../../src/character-chat/AudioPlaybackController'
const telemetry:any[]=[]
telemetry.push({type:'visibility',hidden:document.hidden,state:document.visibilityState})
document.addEventListener('visibilitychange',()=>telemetry.push({type:'visibility',hidden:document.hidden,state:document.visibilityState}))
const nativeReceive=AudioPlaybackController.prototype.receive
AudioPlaybackController.prototype.receive=async function(event){telemetry.push({type:'controller-receive',event:event.type,eventEpoch:event.epoch,epoch:(this as any).epoch,visible:(this as any).visible,disposed:(this as any).disposed});return nativeReceive.call(this,event)}
const NativeAudioContext=window.AudioContext
// Observe native Web Audio; decoding, scheduling and output remain real.
class ObservedAudioContext extends NativeAudioContext{
 constructor(options?:AudioContextOptions){super(options);telemetry.push({type:'context',state:this.state,sampleRate:this.sampleRate});this.addEventListener('statechange',()=>telemetry.push({type:'context-state',state:this.state,time:this.currentTime}))}
 async decodeAudioData(data:ArrayBuffer,...args:any[]):Promise<AudioBuffer>{const buffer=await super.decodeAudioData(data,...args);let peak=0;for(const v of buffer.getChannelData(0))peak=Math.max(peak,Math.abs(v));telemetry.push({type:'decoded',samples:buffer.length,channels:buffer.numberOfChannels,sampleRate:buffer.sampleRate,peak});return buffer}
 createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source),stop=source.stop.bind(source);source.start=(...args)=>{telemetry.push({type:'source-start',time:this.currentTime,when:args[0]??0,state:this.state});start(...args)};source.stop=(...args)=>{telemetry.push({type:'source-stop',time:this.currentTime});stop(...args)};source.addEventListener('ended',()=>telemetry.push({type:'source-ended',time:this.currentTime}));return source}
}
window.AudioContext=ObservedAudioContext
;(window as any).voiceQa={telemetry,snapshot:null,actions:[],events:[]}
window.characterVoice.onEvent(e=>(window as any).voiceQa.events.push(e))
function Qa(){
 const [state,setState]=useState<VoiceSnapshot|null>(null)
 useEffect(()=>{const receive=(value:VoiceSnapshot)=>{(window as any).voiceQa.snapshot=value;setState(value)};const off=window.characterVoice.subscribe(receive);void window.characterVoice.action({type:'snapshot'}).then(receive);return off},[])
 const act=async(value:VoiceAction)=>{(window as any).voiceQa.actions.push(value.type);const result=await window.characterVoice.action(value);(window as any).voiceQa.snapshot=result;setState(result)}
 return <><h1>분리된 Qwen ICL 검증</h1><p>새 QA 프로필 · 기존 앱/설정과 분리 · 실제 음성 UI와 Web Audio</p><VoiceControls/>{state&&<VoiceSettings state={state} characterId="voice-qa" act={act} playbackReady/>}</>
}
createRoot(document.getElementById('root')!).render(<Qa/> )
