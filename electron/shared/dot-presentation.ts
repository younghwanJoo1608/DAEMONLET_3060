import type {CharacterChatDefinition} from './character-chat-semantics'
export const DOT_IPC={get:'dot-presentation.get',changed:'dot-presentation.changed',ready:'dot-presentation.ready',voiceAction:'dot-presentation.voice-action',audio:'dot-presentation.audio',voiceEvent:'dot-presentation.voice-event',volume:'dot-presentation.volume',volumeChanged:'dot-presentation.volume-changed'} as const
export const DOT_TEXT_LIMIT=600
// UTF-16 units, matching the lossless local utterance planner; never silently truncate.
export const DOT_FULL_TEXT_LIMIT=6000
export const DOT_VOICE_PREPARATION_TIMEOUT_MS=900_000
export const DOT_VOICE_MAX_READING_MS=600_000
export const DOT_VOICE_STALL_TIMEOUT_MS=60_000
export const DOT_STATES=['idle','thinking','speaking','done','error'] as const
export const DOT_POSES=['neutral','listening','thinking','happy','sad','error'] as const
export type DotVoiceFailure='preparation-timeout'|'stalled'|'speech-timeout'|'failed'
export type DotCommand={type:'present';text?:string;speechText?:string;speechMode:'bounded'|'complete';pose:typeof DOT_POSES[number];state:typeof DOT_STATES[number];speak:boolean;durationMs:number;fallback:boolean}|{type:'cancel'}
export type DotFrame={sequence:number;active:boolean;characterId:string|null;revision:string|null;text:string;pose:typeof DOT_POSES[number];state:typeof DOT_STATES[number];definition:CharacterChatDefinition;expiresAt:number;muted:boolean;voicePhase?:'preparing'|'playing'|'error';voiceError?:DotVoiceFailure}
export type DotStatus={sequence:number;phase:'idle'|'displaying'|'preparing'|'playing'|'completed'|'cancelled'|'replaced'|'expired'|'failed';muted:boolean;paused:boolean;available:boolean;error?:DotVoiceFailure}
export interface DotPresentationApi{get():Promise<DotFrame|null>;subscribe(listener:(frame:DotFrame|null)=>void):()=>void;ready(value:boolean):Promise<void>}
function text(value:unknown,complete:boolean){
 if(typeof value!=='string'||!value.trim()||(complete?value.length>DOT_FULL_TEXT_LIMIT:[...value].length>DOT_TEXT_LIMIT)||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(value))throw Error('DOT_TEXT')
 const normalized=value.normalize('NFC').trim()
 if(complete&&normalized.length>DOT_FULL_TEXT_LIMIT)throw Error('DOT_TEXT')
 return normalized
}
export function parseDotCommand(value:unknown):DotCommand{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('DOT_ARGUMENTS')
 const v=value as Record<string,unknown>
 if(v.type==='cancel'&&Object.keys(v).length===1)return {type:'cancel'}
 if(v.type!=='present'||Object.keys(v).some(k=>!['type','text','speechText','speechMode','pose','state','speak','durationMs'].includes(k)))throw Error('DOT_ARGUMENTS')
 if(v.speechMode!==undefined&&!['bounded','complete'].includes(v.speechMode as string))throw Error('DOT_ARGUMENTS')
 const complete=v.speechMode==='complete'
 if((complete||v.speechText!==undefined)&&(v.speak!==true||v.text===undefined))throw Error('DOT_ARGUMENTS')
 const display=v.text===undefined?undefined:text(v.text,complete),spoken=v.speechText===undefined?undefined:text(v.speechText,complete)
 if(v.pose!==undefined&&(typeof v.pose!=='string'||!/^[a-zA-Z0-9_-]{1,48}$/.test(v.pose)))throw Error('DOT_POSE')
 if(v.state!==undefined&&!DOT_STATES.includes(v.state as any)||v.speak!==undefined&&typeof v.speak!=='boolean')throw Error('DOT_ARGUMENTS')
 if(v.durationMs!==undefined&&(!Number.isInteger(v.durationMs)||(v.durationMs as number)<1000||(v.durationMs as number)>30000))throw Error('DOT_DURATION')
 if(v.text===undefined&&v.pose===undefined&&v.state===undefined||v.speak===true&&v.text===undefined)throw Error('DOT_ARGUMENTS')
 const fallback=v.pose!==undefined&&!DOT_POSES.includes(v.pose as any)
 return {type:'present',...(display===undefined?{}:{text:display}),...(spoken===undefined?{}:{speechText:spoken}),speechMode:complete?'complete':'bounded',pose:fallback?'neutral':(v.pose??'neutral') as any,state:(v.state??'idle') as any,speak:v.speak===true,durationMs:(v.durationMs??12000) as number,fallback}
}
