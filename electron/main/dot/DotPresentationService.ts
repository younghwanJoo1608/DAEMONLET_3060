import {parseDotCommand,DOT_VOICE_PREPARATION_TIMEOUT_MS,DOT_VOICE_MAX_READING_MS,DOT_VOICE_STALL_TIMEOUT_MS,type DotFrame,type DotStatus,type DotVoiceFailure} from '../../shared/dot-presentation'
import {emptyChat,type CharacterChatDefinition} from '../../shared/character-chat-semantics'
export type DotContext={characterId:string;revision:string;definition:CharacterChatDefinition}
export type DotResult={accepted:true;sequence:number;poseFallback:boolean;voice:'muted'|'off'|'requested'}
/** One session-owned presentation. No text, transcript or playback history is persisted. */
export class DotPresentationService{
 muted=true;quiet=false
 private sequence=0
 private request=0
 private muteSequence=0
 private frame:DotFrame|null=null
 private controller:AbortController|null=null
 private timer:ReturnType<typeof setTimeout>|null=null
 private progressTimer:ReturnType<typeof setTimeout>|null=null
 private last:Pick<DotStatus,'sequence'|'phase'|'error'>={sequence:0,phase:'idle'}
 private closed=false
 constructor(private context:()=>DotContext|null,private publish:(frame:DotFrame|null)=>void,private speak:(text:string,signal:AbortSignal,onPlaybackScheduled:(delayMs:number)=>void)=>Promise<void>,private stop:(failure?:DotVoiceFailure)=>Promise<void>,private changed:()=>void=()=>{},private voiceIssue:()=>boolean=()=>false,private muteVoice:(value:boolean)=>Promise<void>=async()=>{}){}
 snapshot(){return this.frame?structuredClone(this.frame):null}
 status():DotStatus{return {...this.last,muted:this.muted,paused:this.quiet,available:!this.closed&&!!this.context()}}
 private arm(sequence:number,ms:number,expired:()=>void){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;if(sequence===this.sequence)expired()},ms)}
 private clearProgress(){if(this.progressTimer)clearTimeout(this.progressTimer);this.progressTimer=null}
 async present(value:unknown):Promise<DotResult>{
  const cmd=parseDotCommand(value)
  if(this.closed)throw Error('DOT_UNAVAILABLE')
  if(cmd.type==='cancel'){await this.cancel();return {accepted:true,sequence:this.sequence,poseFallback:false,voice:'off'}}
  if(this.quiet)throw Error('DOT_QUIET')
  const context=this.context();if(!context)throw Error('DOT_UNAVAILABLE')
  if(cmd.speak&&!this.muted&&this.voiceIssue())throw Error('DOT_VOICE_UNAVAILABLE')
  const request=++this.request;await this.retire('replaced');if(request!==this.request)throw Error('DOT_CANCELLED')
  if(this.closed||this.quiet||this.context()?.characterId!==context.characterId||this.context()?.revision!==context.revision)throw Error('DOT_UNAVAILABLE')
  const controller=this.controller=new AbortController(),sequence=++this.sequence,voiced=cmd.speak&&!this.muted,complete=cmd.speechMode==='complete'
  const lifetime=voiced?DOT_VOICE_PREPARATION_TIMEOUT_MS:cmd.durationMs
  this.frame={sequence,active:true,characterId:context.characterId,revision:context.revision,text:voiced?'':cmd.text??'',pose:cmd.pose,state:cmd.state,definition:{...emptyChat(),presentation:structuredClone(context.definition.presentation)},expiresAt:Date.now()+lifetime,muted:this.muted,...(voiced?{voicePhase:'preparing' as const}:{})}
  this.last={sequence,phase:voiced?'preparing':'displaying'}
  try{this.publish(this.snapshot())}catch{await this.cancel();throw Error('DOT_UNAVAILABLE')}this.changed()
  const current=()=>sequence===this.sequence&&this.controller===controller&&!controller.signal.aborted&&!this.closed&&!this.quiet&&!this.muted&&this.context()?.characterId===context.characterId&&this.context()?.revision===context.revision
  const failed=(reason:DotVoiceFailure='failed')=>{
   if(!current())return
   const code={ 'preparation-timeout':'VOICE_PRESENTATION_PREPARATION_TIMEOUT',stalled:'VOICE_PRESENTATION_STALLED','speech-timeout':'VOICE_PRESENTATION_SPEECH_TIMEOUT',failed:'VOICE_PRESENTATION_FAILED' }[reason]
   controller.abort(Error(code));this.clearProgress()
   this.last={sequence,phase:'failed',error:reason}
   this.frame={...this.frame!,text:'',state:'error',voicePhase:'error',voiceError:reason,expiresAt:Date.now()+cmd.durationMs}
   try{this.publish(this.snapshot())}catch{void this.cancel();return}this.changed()
   void this.stop(reason).catch(()=>{this.quiet=true;this.changed()})
   this.arm(sequence,cmd.durationMs,()=>{void this.retire('failed')})
  }
  this.arm(sequence,lifetime,()=>{if(voiced)failed('preparation-timeout');else void this.retire('expired')})
  const result:DotResult={accepted:true,sequence,poseFallback:cmd.fallback,voice:cmd.speak?(this.muted?'muted':'requested'):'off'}
  if(voiced){
   let started=false
   const scheduled=(delayMs:number)=>{
    if(!current()||!Number.isFinite(delayMs)||delayMs<0||delayMs>6000)return
    // Only unique, current-epoch, claimed audio ACKs reach this callback.
    // Progress may refresh a stall deadline, never the absolute reading limit.
    if(complete){this.clearProgress();this.progressTimer=setTimeout(()=>{this.progressTimer=null;failed('stalled')},DOT_VOICE_STALL_TIMEOUT_MS+Math.ceil(delayMs))}
    if(started)return
    started=true;this.last={sequence,phase:'playing'}
    const duration=complete?DOT_VOICE_MAX_READING_MS:cmd.durationMs
    this.frame={...this.frame!,text:cmd.text??'',voicePhase:'playing',expiresAt:Date.now()+Math.ceil(delayMs)+duration}
    try{this.publish(this.snapshot())}catch{void this.cancel();return}this.changed()
    this.arm(sequence,Math.ceil(delayMs)+duration,()=>{if(complete)failed('speech-timeout');else void this.retire('expired')})
   }
   // speechText is caller-authored spoken wording; never send it to the bubble or status.
   void this.speak(cmd.speechText??cmd.text!,controller.signal,scheduled).then(()=>{if(current()){if(started)void this.retire('completed');else failed()}}).catch(e=>{if(current()){if(e instanceof Error&&e.message==='VOICE_CANCELLED')void this.cancel();else failed()}})
  }
  return result
 }
 async cancel(){++this.request;await this.retire('cancelled')}
 private async retire(outcome:DotStatus['phase']){
  ++this.sequence;this.controller?.abort();this.controller=null
  if(this.timer)clearTimeout(this.timer);this.timer=null;this.clearProgress()
  const owned=!!this.frame
  if(owned)this.last={sequence:this.frame!.sequence,phase:outcome,...(outcome==='failed'&&this.last.error?{error:this.last.error}:{})}
  this.frame=null;try{this.publish(null)}catch{}
  if(owned){try{await this.stop()}catch{this.quiet=true}}this.changed()
 }
 async setQuiet(value:boolean){this.quiet=value;if(value)await this.cancel();this.changed()}
 async setMuted(value:boolean){
  const sequence=++this.muteSequence;this.muted=value
  const cleanup=this.muteVoice(value);void cleanup.catch(()=>{})
  try{if(value)await this.cancel();await cleanup}catch(e){if(sequence===this.muteSequence)this.quiet=true;throw e}finally{if(sequence===this.muteSequence)this.changed()}
 }
 async close(){this.closed=true;await this.setMuted(true)}
}
