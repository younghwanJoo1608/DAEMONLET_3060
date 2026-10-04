// QA entry only: real voice controller/worker/UI, no desktop application services.
import {app,BrowserWindow,protocol,net,session} from 'electron'
import {readFile,writeFile} from 'node:fs/promises'
import {readFileSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {VoiceIpcController} from '../../electron/main/character-voice/VoiceIpcController'
import {WindowsGgufRuntimeInstaller} from '../../electron/main/character-voice/WindowsGgufRuntimeInstaller'
import {secureWebContents,denyAllPermissions} from '../../electron/main/SecurityPolicy'
async function main(){
const configPath=process.argv.find(v=>v.startsWith('--voice-qa-config='))?.slice('--voice-qa-config='.length)
if(!configPath)throw Error('VOICE_QA_CONFIG_REQUIRED')
const config=JSON.parse(readFileSync(configPath,'utf8')),root=resolve(config.root)
const marker=JSON.parse(readFileSync(join(root,'.voice-qa-owner.json'),'utf8'))
if(marker.owner!=='daemonlet-isolated-voice-qa'||marker.root!==root)throw Error('VOICE_QA_ROOT_INVALID')
const profile=join(root,'profile'),voice=join(root,'voice-data'),assets=join(root,'voice'),bundle=join(root,'bundle')
mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',join(profile,'session'));app.setPath('logs',join(root,'logs'))
app.setName('Daemonlet isolated voice QA')
protocol.registerSchemesAsPrivileged([{scheme:'pet',privileges:{standard:true,secure:true,supportFetchAPI:true}}])
const result:any={status:'STARTING',electron:process.versions.electron,checks:[],events:[],observationLimits:['No official CUA tools available','No screenshot or OS UI automation','No acoustic speaker recording or listening assessment'],startedAt:new Date().toISOString()}
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex')
let controller:VoiceIpcController|undefined,win:BrowserWindow|undefined
const check=(name:string,condition:unknown)=>{if(!condition)throw Error(name);result.checks.push(name);console.log(JSON.stringify({check:name}))}
const runtimeAudit=()=>{const runtime=(controller?.service as any)?.runtime;return {pid:runtime?.child?.pid,sessionId:runtime?.sessionId,audit:runtime?.audit,ready:runtime?.ready}}
const wait=async(condition:()=>Promise<any>,timeout=90000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await condition();if(value)return value;await new Promise(r=>setTimeout(r,100))}throw Error('QA_WAIT_TIMEOUT')}
try{
 await app.whenReady()
 const bytes=await readFile(join(assets,'managed-gguf-runtime-catalog.json')),catalog=JSON.parse(bytes.toString()),catalogSha=sha(bytes)
 check('source-catalog-pin',catalogSha===config.catalogSha256)
 const rt=join(voice,'rt',catalogSha.slice(0,16)),installer=new WindowsGgufRuntimeInstaller(rt,()=>{},{catalog,catalogSha256:catalogSha,layout:'compact-v1'})
 await installer.initialize();const connection=await installer.verify('qwen-cuda')
 result.runtime={...connection,catalogSha256:catalogSha}
 await writeFile(join(voice,'settings.json'),JSON.stringify({version:1,engine:'qwen3-tts-06b-gguf',enabled:false,autoRead:false,volume:.35,bindings:{},qwenClone:{mode:'x-vector',transcript:''},qwenGgufExecutionProfile:'qwen-gguf',qwenGgufRuntime:{python:connection.python,model:config.model,ggufRuntime:connection.runtimeDir,managedRuntime:connection.managedRuntime,dependencyDirs:connection.dependencyDirs},seedSettings:{mode:'fixed',fixedSeed:42}}))
 const chatState:any={epoch:1,character:{id:'voice-qa',revision:'1'},model:'voice-qa',conversation:{id:'voice-qa-conversation',messages:[]}}
 const chat:any={snapshot:()=>chatState,subscribeVoiceStart:()=>()=>{},subscribeVoice:()=>()=>{},subscribe:()=>()=>{}}
 const isolated=session.fromPartition('voice-qa-'+marker.id,{cache:false});denyAllPermissions(isolated)
 isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('pet://app/')}))
 isolated.protocol.handle('pet',request=>{const url=new URL(request.url),name=url.pathname.slice(1);if(url.host!=='app'||!['character-chat.html','renderer.js'].includes(name))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(join(bundle,name)).href)})
 win=new BrowserWindow({title:'Daemonlet isolated ICL QA',width:1000,height:850,show:true,webPreferences:{preload:join(bundle,'preload.cjs'),session:isolated,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}})
 secureWebContents(win.webContents,'character-chat')
 win.webContents.on('console-message',(_event,level,message)=>result.events.push({type:'console',level,message}))
 win.webContents.on('render-process-gone',(_event,details)=>result.events.push({type:'renderer-gone',details}))
 controller=new VoiceIpcController(voice,join(assets,'worker.py'),()=>win??null,chat)
 await controller.initialize();await controller.service.importReference(config.reference,'Authorized QA reference')
 const reference=controller.service.snapshot().profiles.find(p=>p.kind==='wav-reference')
 check('reference-import',reference&&'referenceSha256' in reference&&reference.referenceSha256===config.referenceSha256)
 await controller.service.bind('voice-qa',reference!.id+'@'+reference!.version)
 controller.attachWindow(win);await win.loadURL('pet://app/character-chat.html')
 const js=(code:string)=>win!.webContents.executeJavaScript(code,true)
 await wait(()=>js('!!window.voiceQa?.snapshot && !!document.querySelector(".voice-qwen-settings select")'))
 win.show();win.focus()
 await wait(()=>js('document.visibilityState === "visible" && !document.hidden'),15000)
 check('renderer-visible-before-actions',await js('!document.hidden'))
 check('trusted-renderer-ready',controller.playbackReady)
 await js('const select=document.querySelector(".voice-qwen-settings select");select.value="icl";select.dispatchEvent(new Event("change",{bubbles:true}));')
 await wait(()=>js('!!document.querySelector(".voice-qwen-settings textarea")'))
 check('icl-empty-transcript-apply-disabled',await js('Array.from(document.querySelectorAll(".voice-qwen-settings button")).find(b=>b.textContent.includes("방식 적용")).disabled'))
 await js(`const t=document.querySelector('.voice-qwen-settings textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(config.transcript)});t.dispatchEvent(new Event('input',{bubbles:true}));`)
 await wait(()=>js('!Array.from(document.querySelectorAll(".voice-qwen-settings button")).find(b=>b.textContent.includes("방식 적용")).disabled'))
 await js('Array.from(document.querySelectorAll(".voice-qwen-settings button")).find(b=>b.textContent.includes("방식 적용")).click()')
 await wait(async()=>controller!.service.snapshot().qwenClone?.mode==='icl')
 check('icl-transcript-exact',controller.service.snapshot().qwenClone?.transcript===config.transcript)
 const invoke=(value:any)=>js(`window.characterVoice.action(${JSON.stringify(value)})`)
 const invalid=await invoke({type:'qwenClone',value:{mode:'icl',transcript:''}})
 check('invalid-icl-transcript-error',invalid.error==='QWEN_TRANSCRIPT_REQUIRED')
 const recovered=await invoke({type:'qwenClone',value:{mode:'icl',transcript:config.transcript}})
 check('icl-error-recovery',!recovered.error&&recovered.qwenClone.mode==='icl')
 const terms=controller.service.snapshot().ggufRuntimeTerms
 result.terms={fingerprint:terms?.fingerprint,accepted:terms?.accepted,documents:terms?.documents}
 if(!terms?.accepted&&!config.runtimeTermsApproved){result.status='BLOCKED_RUNTIME_TERMS_APPROVAL';result.renderer=await js('window.voiceQa')}
 else{
  if(!terms?.accepted){await invoke({type:'acceptGgufRuntimeTerms',fingerprint:terms!.fingerprint});check('explicit-runtime-terms-recorded',controller.service.snapshot().ggufRuntimeTerms?.accepted)}
  const prepareStarted=Date.now();await invoke({type:'enabled',value:true});await invoke({type:'prepare'});result.prepareWallMs=Date.now()-prepareStarted
  check('icl-runtime-ready',controller.service.snapshot().engineReady&&!controller.service.snapshot().error)
  result.prepared=controller.service.snapshot();result.runtimePrepared=runtimeAudit()
  const telemetry=()=>js('window.voiceQa.telemetry')
  const playbackWait=(condition:()=>Promise<any>)=>wait(async()=>{const snapshot=controller!.service.snapshot();if(snapshot.error)throw Error('QA_PLAYBACK_'+snapshot.error);return condition()})
  result.playbackDocument=await js('({hidden:document.hidden,visibility:document.visibilityState,focused:document.hasFocus()})')
  await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="시험 재생").click()')
  await playbackWait(async()=>(await telemetry()).some((v:any)=>v.type==='source-ended'))
  await wait(async()=>!['loading','synthesizing','playing'].includes(controller!.service.snapshot().status))
  check('native-web-audio-running',(await telemetry()).some((v:any)=>v.type==='source-start'&&v.state==='running'))
  check('decoded-non-silent-pcm',(await telemetry()).some((v:any)=>v.type==='decoded'&&v.peak>0&&v.channels===1))
  result.runtimeAfterFirst=runtimeAudit()
  const before=(await telemetry()).filter((v:any)=>v.type==='source-start').length
  await invoke({type:'test'});await playbackWait(async()=>(await telemetry()).filter((v:any)=>v.type==='source-start').length>before)
  const stopStarted=Date.now();await invoke({type:'stop'});result.stopWallMs=Date.now()-stopStarted;result.runtimeAfterStop=runtimeAudit();check('stop-output',(await telemetry()).some((v:any)=>v.type==='source-stop'))
  const after=(await telemetry()).filter((v:any)=>v.type==='source-ended').length
  await invoke({type:'test'});await playbackWait(async()=>(await telemetry()).filter((v:any)=>v.type==='source-ended').length>after)
  await wait(async()=>!['loading','synthesizing','playing'].includes(controller!.service.snapshot().status))
  check('re-request-after-stop',!controller.service.snapshot().error)
  result.runtimeAfterRerequest=runtimeAudit()
  check('same-worker-pid-after-stop',Number.isSafeInteger(result.runtimePrepared.pid)&&[result.runtimeAfterFirst,result.runtimeAfterStop,result.runtimeAfterRerequest].every(v=>v.pid===result.runtimePrepared.pid&&v.sessionId===result.runtimePrepared.sessionId))
  result.finalSnapshot=controller.service.snapshot();result.renderer=await js('window.voiceQa')
  result.status='PASS_ISOLATED_ICL_UI_IPC_WEB_AUDIO'
 }
}catch(error){result.status='FAIL';result.error=error instanceof Error?error.stack:String(error);result.failureSnapshot=controller?.service.snapshot();result.failureRuntime=runtimeAudit();if(win&&!win.isDestroyed())result.renderer=await win.webContents.executeJavaScript('window.voiceQa').catch(()=>null)}
finally{
 await controller?.close().catch(error=>result.cleanupError=String(error));win?.destroy()
 result.finishedAt=new Date().toISOString();await writeFile(join(root,'qa-result.json'),JSON.stringify(result,null,2))
 console.log(JSON.stringify({status:result.status,checks:result.checks,error:result.error}));app.exit(result.status==='FAIL'?1:0)
}}
void main().catch(error=>{console.error(error);app.exit(1)})
