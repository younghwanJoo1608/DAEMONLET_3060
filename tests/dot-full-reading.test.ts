import {afterEach,expect,it,vi} from 'vitest'
import {DotPresentationService} from '../electron/main/dot/DotPresentationService'
import {parseDotCommand,DOT_FULL_TEXT_LIMIT,DOT_VOICE_MAX_READING_MS,DOT_VOICE_STALL_TIMEOUT_MS} from '../electron/shared/dot-presentation'
import {emptyChat} from '../electron/shared/character-chat-semantics'
import {planSpeech} from '../electron/shared/voice-utterance-plan'
import {validatePetBubblePresentation} from '../electron/shared/bubble-presentation'
import {dotBubble} from '../src/pet/DotPresentationController'
const clean:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const f of clean.splice(0))await f();vi.useRealTimers()})
function fixture(){
 let context:any={characterId:'private-character',revision:'private-revision',definition:emptyChat()}
 const jobs:Array<{text:string;signal:AbortSignal;scheduled:(ms:number)=>void;resolve:()=>void;reject:(e:Error)=>void}>=[]
 const speak=vi.fn((text:string,signal:AbortSignal,scheduled:(ms:number)=>void)=>new Promise<void>((resolve,reject)=>jobs.push({text,signal,scheduled,resolve,reject})))
 const stop=vi.fn(async()=>{}),publish=vi.fn(),service=new DotPresentationService(()=>context,publish,speak,stop)
 clean.push(()=>service.close());return{service,jobs,speak,stop,publish,context:(v:any)=>context=v}
}
const full=(extra:Record<string,unknown>={})=>({type:'present',text:'문장 내용; 수식 a > b와 코드 x++;는 의미를 유지합니다.',speak:true,speechMode:'complete',durationMs:1000,...extra})
it('accepts a bounded full answer and keeps legacy limits and mode semantics',()=>{
 expect(parseDotCommand(full({text:'가'.repeat(DOT_FULL_TEXT_LIMIT)}))).toMatchObject({speechMode:'complete'})
 for(const v of [full({text:'가'.repeat(6001)}),full({text:'😀'.repeat(3001)}),full({speechText:'가'.repeat(6001)}),full({speechText:''}),full({speechText:'bad\u202e'}),full({speechText:'bad'+String.fromCharCode(0xd800)}),full({speak:false}),full({text:undefined}),full({speechMode:'infinite'}),{type:'present',text:'가'.repeat(601)},{type:'present',text:'ok',speechText:'spoken'},{type:'present',text:'ok',speak:true,speechText:'가'.repeat(601)}])expect(()=>parseDotCommand(v)).toThrow()
})
it('preserves all display/source syntax while forwarding distinct spoken wording exactly once',async()=>{
 vi.useFakeTimers();const f=fixture();await f.service.setMuted(false)
 const text='원문; a > b, x++; 그리고 C++입니다.\n'.repeat(25),spoken='원문의 내용을 이어서 말할게요. 에이가 비보다 크고, 엑스를 하나 증가시킵니다. 언어는 씨 플러스 플러스입니다.\n'.repeat(25)
 const receipt=await f.service.present(full({text,speechText:spoken}));expect(f.jobs[0].text).toBe(spoken.trim());expect(f.speak).toHaveBeenCalledTimes(1)
 f.jobs[0].scheduled(240);expect(dotBubble(f.service.snapshot())?.text).toBe(text.trim())
 expect(JSON.stringify(f.service.snapshot())).not.toContain('에이가');expect(JSON.stringify(f.service.status())).not.toMatch(/원문|에이가|private-character|private-revision/)
 expect(f.service.status()).toMatchObject({sequence:receipt.sequence,phase:'playing'})
 const segments=planSpeech(spoken.trim()).segments;expect(segments.length).toBeGreaterThan(1);expect(segments.map(s=>s.text).join('')).toBe(spoken.trim())
})
it('does not blindly remove semicolons, code or mathematical symbols when no speechText is supplied',async()=>{const f=fixture();await f.service.setMuted(false);const command=full();await f.service.present(command);expect(f.jobs[0].text).toBe(command.text)})
it('complete speech outlives both durationMs and 30 seconds, then records actual completion',async()=>{
 vi.useFakeTimers();const f=fixture();await f.service.setMuted(false);const receipt=await f.service.present(full());f.jobs[0].scheduled(240)
 await vi.advanceTimersByTimeAsync(31000);expect(f.jobs[0].signal.aborted).toBe(false);expect(f.service.status().phase).toBe('playing')
 f.jobs[0].scheduled(100);await vi.advanceTimersByTimeAsync(31000);expect(f.service.snapshot()).not.toBeNull()
 f.jobs[0].resolve();await vi.advanceTimersByTimeAsync(0);expect(f.service.snapshot()).toBeNull();expect(f.service.status()).toMatchObject({sequence:receipt.sequence,phase:'completed'})
})
it('retains finite preparation, progress-stall and absolute reading deadlines',async()=>{
 vi.useFakeTimers();const f=fixture();await f.service.setMuted(false);await f.service.present(full());await vi.advanceTimersByTimeAsync(900000)
 expect(f.service.status()).toMatchObject({phase:'failed',error:'preparation-timeout'});expect(f.jobs[0].signal.aborted).toBe(true)
 await f.service.present(full());f.jobs[1].scheduled(0);await vi.advanceTimersByTimeAsync(DOT_VOICE_STALL_TIMEOUT_MS)
 expect(f.service.status()).toMatchObject({phase:'failed',error:'stalled'});expect(f.stop).toHaveBeenCalledWith('stalled')
 await f.service.present(full());const job=f.jobs[2];job.scheduled(0)
 for(let elapsed=0;elapsed<DOT_VOICE_MAX_READING_MS;elapsed+=30000){await vi.advanceTimersByTimeAsync(30000);job.scheduled(0)}
 expect(job.signal.aborted).toBe(true);expect(f.service.status()).toMatchObject({phase:'failed',error:'speech-timeout'});expect(f.stop).toHaveBeenCalledWith('speech-timeout')
})
it.each(['cancel','mute','quiet','close','hidden','local-chat'] as const)('complete mode honors %s and stale progress cannot revive it',async boundary=>{
 vi.useFakeTimers();const f=fixture();await f.service.setMuted(false);await f.service.present(full());const old=f.jobs[0];old.scheduled(0)
 if(boundary==='mute')await f.service.setMuted(true)
 else if(boundary==='quiet')await f.service.setQuiet(true)
 else if(boundary==='close')await f.service.close()
 else{if(boundary==='hidden'||boundary==='local-chat')f.context(null);await f.service.cancel()}
 old.scheduled(0);old.resolve();await vi.advanceTimersByTimeAsync(900000)
 expect(old.signal.aborted).toBe(true);expect(f.service.snapshot()).toBeNull();expect(f.service.status().phase).toBe('cancelled')
 if(boundary==='hidden'||boundary==='local-chat')await expect(f.service.present(full())).rejects.toThrow('DOT_UNAVAILABLE')
})
it('new presentation replaces instead of queues; old completion/progress cannot finish the successor',async()=>{
 vi.useFakeTimers();const f=fixture();await f.service.setMuted(false);const first=await f.service.present(full());f.jobs[0].scheduled(0)
 const second=await f.service.present(full({text:'다음 원문',speechText:'다음 낭독'}));expect(second.sequence).toBeGreaterThan(first.sequence);expect(f.jobs[0].signal.aborted).toBe(true)
 f.jobs[0].scheduled(0);f.jobs[0].resolve();await vi.advanceTimersByTimeAsync(0);expect(f.service.status()).toMatchObject({sequence:second.sequence,phase:'preparing'})
 f.jobs[1].scheduled(0);f.jobs[1].resolve();await vi.advanceTimersByTimeAsync(0);expect(f.service.status().phase).toBe('completed')
})
it('mute retains original full display only for the existing display lifetime and never synthesizes',async()=>{
 vi.useFakeTimers();const f=fixture(),text='가'.repeat(6000);await f.service.present(full({text,speechText:'다르게 읽을 내용'}));expect(f.service.snapshot()?.text).toBe(text);expect(f.speak).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(1000);expect(f.service.snapshot()).toBeNull();expect(f.service.status().phase).toBe('expired')
})
it('reports synthesis failure without leaking speech text; a following request can complete',async()=>{
 vi.useFakeTimers();const f=fixture();await f.service.setMuted(false);await f.service.present(full());f.jobs[0].reject(Error('private failure detail'));await vi.advanceTimersByTimeAsync(0)
 expect(f.service.status()).toMatchObject({phase:'failed',error:'failed'});expect(JSON.stringify(f.service.status())).not.toContain('private')
 await f.service.present(full());f.jobs[1].scheduled(0);f.jobs[1].resolve();await vi.advanceTimersByTimeAsync(0);expect(f.service.status().phase).toBe('completed')
})
it('bubble bridge accepts full dot display while retaining small authored-dialogue bounds',()=>{
 const report={epoch:1,sequence:1,available:true,phase:'shown',anchor:null},speech={text:'가'.repeat(6000),width:240,height:140,fadeMs:0,dotSequence:1}
 expect(validatePetBubblePresentation({...report,speech})?.speech?.text).toBe(speech.text)
 expect(validatePetBubblePresentation({...report,speech:{...speech,text:'가'.repeat(6001)}})).toBeNull()
 const {dotSequence,...authored}=speech;expect(validatePetBubblePresentation({...report,speech:authored})).toBeNull()
})
