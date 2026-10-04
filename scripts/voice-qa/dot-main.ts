// Real native ICL + production Dot service/voice IPC/Web Audio; private profile only.
import {app,BrowserWindow,protocol,net,session,ipcMain} from 'electron'
import {readFile,writeFile} from 'node:fs/promises'
import {readFileSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash,randomBytes} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {VoiceIpcController} from '../../electron/main/character-voice/VoiceIpcController'
import {WindowsGgufRuntimeInstaller} from '../../electron/main/character-voice/WindowsGgufRuntimeInstaller'
import {secureWebContents,denyAllPermissions,isTrustedSender} from '../../electron/main/SecurityPolicy'
import {DotPresentationService} from '../../electron/main/dot/DotPresentationService'
import {DotBridgeServer} from '../../electron/main/dot/DotBridgeServer'
import {DOT_IPC} from '../../electron/shared/dot-presentation'
import {emptyChat} from '../../electron/shared/character-chat-semantics'
import {planSpeech} from '../../electron/shared/voice-utterance-plan'
import {localForward,createMcpHandler} from '../dot-presentation-mcp.mjs'
async function main(){
 const configPath=process.argv.find(v=>v.startsWith('--voice-qa-config='))?.slice('--voice-qa-config='.length)
 if(!configPath)throw Error('VOICE_QA_CONFIG_REQUIRED')
 const config=JSON.parse(readFileSync(configPath,'utf8')),root=resolve(config.root),marker=JSON.parse(readFileSync(join(root,'.voice-qa-owner.json'),'utf8'))
 if(marker.owner!=='daemonlet-isolated-voice-qa'||marker.root!==root)throw Error('VOICE_QA_ROOT_INVALID')
 const profile=join(root,'profile'),voice=join(root,'voice-data'),assets=join(root,'voice'),bundle=join(root,'bundle')
 mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',join(profile,'session'));app.setPath('logs',join(root,'logs'));app.setName('Daemonlet isolated full reading QA')
 protocol.registerSchemesAsPrivileged([{scheme:'pet',privileges:{standard:true,secure:true,supportFetchAPI:true}}])
 const result:any={status:'STARTING',checks:[],gpu:[],stages:[],startedAt:new Date().toISOString(),installedAppChanged:false,externalNetworkUsed:false,observationLimits:['Real Web Audio scheduling and completion; no acoustic recording','Synthetic pet renderer; full installed desktop not launched','Whole-GPU samples include other applications']}
 const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex'),run=promisify(execFile)
 const gpu=async()=>{const info=await run(join(process.env.SystemRoot!,'System32','nvidia-smi.exe'),['--query-gpu=memory.total,memory.used,memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000});const [total,used,free]=info.stdout.trim().split(/,\s*/).map(Number);const sample={at:Date.now(),total,used,free};result.gpu.push(sample);return sample}
 const check=(name:string,ok:unknown)=>{if(!ok)throw Error(name);result.checks.push(name);console.log(JSON.stringify({check:name}))}
 const stage=(name:string)=>{result.stages.push({name,at:Date.now()});console.log(JSON.stringify({stage:name}))}
 let controller:VoiceIpcController|undefined,win:BrowserWindow|undefined,dot:DotPresentationService|undefined,server:DotBridgeServer|undefined,monitor:ReturnType<typeof setInterval>|undefined,owner=true
 const wait=async(predicate:()=>Promise<any>|any,timeout=180000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,150))}throw Error('QA_WAIT_TIMEOUT')}
 try{
  // Do not compete with a live installed TTS model on an 8GB device.
  const initial=await gpu();if(initial.free<3500){result.status='BLOCKED_GPU_HEADROOM';result.requiredFreeMiB=3500;return}
  await app.whenReady();monitor=setInterval(()=>{void gpu().catch(()=>{})},3000)
  const bytes=await readFile(join(assets,'managed-gguf-runtime-catalog.json')),catalog=JSON.parse(bytes.toString()),pin=sha(bytes);check('catalog-pin',pin===config.catalogSha256)
  const installer=new WindowsGgufRuntimeInstaller(join(voice,'rt',pin.slice(0,16)),()=>{},{catalog,catalogSha256:pin,layout:'compact-v1'});await installer.initialize();const connection=await installer.verify('qwen-cuda')
  await writeFile(join(voice,'settings.json'),JSON.stringify({version:1,engine:'qwen3-tts-06b-gguf',enabled:false,autoRead:false,volume:.15,bindings:{},qwenClone:{mode:'x-vector',transcript:''},qwenGgufExecutionProfile:'qwen-gguf',qwenGgufRuntime:{python:connection.python,model:config.model,ggufRuntime:connection.runtimeDir,managedRuntime:connection.managedRuntime,dependencyDirs:connection.dependencyDirs},seedSettings:{mode:'fixed',fixedSeed:42}}))
  const chatState:any={epoch:1,character:{id:'voice-qa',revision:'1'},model:'voice-qa',conversation:null}
  const chat:any={snapshot:()=>chatState,subscribeVoiceStart:()=>()=>{},subscribeVoice:()=>()=>{},subscribe:()=>()=>{}}
  const isolated=session.fromPartition('dot-qa-'+marker.id,{cache:false});denyAllPermissions(isolated);isolated.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('pet://app/')}))
  isolated.protocol.handle('pet',request=>{const url=new URL(request.url),name=url.pathname.slice(1);return url.host==='app'&&['pet.html','renderer.js'].includes(name)?net.fetch(pathToFileURL(join(bundle,name)).href):new Response('Not found',{status:404})})
  win=new BrowserWindow({title:'Isolated full reading QA',width:900,height:700,show:true,webPreferences:{preload:join(bundle,'preload.cjs'),session:isolated,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}})
  secureWebContents(win.webContents,'pet')
  controller=new VoiceIpcController(voice,join(assets,'worker.py'),()=>null,chat,undefined,()=>win??null);await controller.initialize()
  await controller.service.importReference(config.reference,'Authorized QA reference');const reference=controller.service.snapshot().profiles.find(p=>p.kind==='wav-reference')
  check('reference-hash',reference&&'referenceSha256' in reference&&reference.referenceSha256===config.referenceSha256);await controller.service.bind('voice-qa',reference!.id+'@'+reference!.version)
  const manage=(v:any)=>controller!.manage(v,win!,()=>!!win&&!win.isDestroyed())
  await manage({type:'qwenClone',value:{mode:'icl',transcript:config.transcript}});check('exact-icl-transcript',controller.service.snapshot().qwenClone?.transcript===config.transcript)
  const terms=controller.service.snapshot().ggufRuntimeTerms
  if(!terms?.accepted){if(!terms||!config.runtimeTermsApproved||terms.fingerprint!==config.approvedTermsFingerprint){result.status='BLOCKED_RUNTIME_TERMS_APPROVAL';return}await manage({type:'acceptGgufRuntimeTerms',fingerprint:terms.fingerprint})}
  await manage({type:'enabled',value:true})
  await controller.attachPresentationWindow(win)
  ipcMain.handle('dot-qa.ready',event=>{if(!isTrustedSender(event,win!,'pet'))throw Error('UNTRUSTED_SENDER');controller!.presentationReady(true);return true})
  dot=new DotPresentationService(()=>owner&&win?.isVisible()?{characterId:'voice-qa',revision:'1',definition:emptyChat()}:null,frame=>win?.webContents.send(DOT_IPC.changed,frame),(text,signal,scheduled)=>controller!.speakPresentation(text,signal,scheduled),failure=>controller!.stopPresentation(failure?'failed':'cancelled',failure?Error('QA_PRESENTATION_'+failure):undefined),()=>{},()=>!!controller!.presentationVoiceIssue(),v=>controller!.setPresentationMuted(v))
  win.on('hide',()=>{void dot?.cancel()})
  await win.loadURL('pet://app/pet.html');win.show();win.focus()
  const js=(code:string)=>win!.webContents.executeJavaScript(code,true),telemetry=()=>js('window.dotQa.telemetry')
  await wait(async()=>await js('!!window.dotQa && !document.hidden')&&(controller as any).petReady,15000)
  server=new DotBridgeServer(dot);const token=randomBytes(32).toString('hex'),port=await server.start({port:0,token}),forward=localForward({DAEMONLET_3060_DOT_TOKEN:token,DAEMONLET_3060_DOT_PORT:String(port)}),handler=createMcpHandler(forward)
  await handler({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handler({jsonrpc:'2.0',method:'notifications/initialized'})
  let callId=2
  const present=async(args:any)=>{const reply:any=await handler({jsonrpc:'2.0',id:callId++,method:'tools/call',params:{name:'present',arguments:args}});if(reply.result?.isError)throw Error(reply.result.content[0].text);return JSON.parse(reply.result.content[0].text)}
  const longText=('전체 내용 확인; 문장부호는 원문에 남깁니다. 조건 a > b와 코드 x++;도 뜻을 바꾸지 않습니다. 화면에는 원문을 보여 주고 음성에서는 자연스럽게 설명합니다. 짧은 표시 시간이 지나도 읽기가 끝날 때까지 이어집니다. 새로운 요청이 오면 이전 읽기는 멈춥니다. 중요한 조건과 숫자는 빠뜨리지 않습니다.\n').repeat(5).trim()
  const spoken=('전체 내용을 확인할게요. 문장부호는 원문에 남겨 둘게요. 에이가 비보다 크다는 조건과 엑스를 하나 증가시키는 코드도 뜻을 바꾸지 않아요. 화면에는 원문을 보여 주고, 음성으로는 자연스럽게 설명할게요. 짧은 표시 시간이 지나도 읽기가 끝날 때까지 이어 가요. 새로운 요청이 오면 이전 읽기를 멈춰요. 중요한 조건과 숫자는 빠뜨리지 않을게요.\n').repeat(5).trim()
  const complete={text:longText,speechText:spoken,speak:true,speechMode:'complete',durationMs:1000},short={...complete,text:'다시 시작합니다.',speechText:'다시 시작할게요.'}
  check('full-input-exceeds-old-limit',longText.length>600&&spoken.length>600)
  const muted=await present(complete);check('muted-no-audio',muted.voice==='muted'&&(await telemetry()).filter((e:any)=>e.type==='start').length===0);await dot.cancel()
  win.hide();await new Promise(r=>setTimeout(r,300));let hidden=false;try{await present(short)}catch(e){hidden=(e as Error).message==='DOT_UNAVAILABLE'}check('hidden-rejected',hidden);win.show();win.focus();await wait(()=>js('!document.hidden'));controller.presentationReady(true)
  await dot.setMuted(false);stage('prepare-icl');await manage({type:'prepare'});check('icl-ready',controller.service.snapshot().engineReady&&!controller.service.snapshot().error)
  const runtime=(controller.service as any).runtime,originalStream=runtime.stream.bind(runtime),submitted:string[]=[]
  runtime.stream=(text:string,...args:any[])=>{submitted.push(text);return originalStream(text,...args)}
  stage('full-reading');const before=(await telemetry()).length,requestAt=Date.now(),receipt=await present(complete)
  await wait(()=>dot!.status().phase==='playing');const playbackAt=Date.now();check('original-display-preserved',await js('window.dotQa.frame.text')===longText)
  await wait(()=>Date.now()-playbackAt>31000);check('reading-survives-thirty-seconds',dot.status().phase==='playing')
  await wait(()=>['completed','failed'].includes(dot!.status().phase),660000);check('full-reading-completed',dot.status().phase==='completed'&&dot.status().sequence===receipt.sequence)
  const played=(await telemetry()).slice(before),decoded=played.filter((e:any)=>e.type==='decoded'),audioSeconds=decoded.reduce((sum:number,e:any)=>sum+e.samples/e.sampleRate,0)
  check('more-than-thirty-seconds-real-pcm',audioSeconds>30);check('real-audio-non-silent',decoded.some((e:any)=>e.peak>0&&e.channels===1));check('all-scheduled-audio-ended',played.filter((e:any)=>e.type==='start').length===played.filter((e:any)=>e.type==='ended').length)
  check('single-request-local-lossless-speech-plan',submitted.join('')===spoken&&submitted.length===planSpeech(spoken).segments.length)
  result.longReading={displayChars:longText.length,speechChars:spoken.length,segments:submitted.length,audioSeconds,wallMs:Date.now()-requestAt,firstPlaybackMs:playbackAt-requestAt,chunks:decoded.length,status:await forward({type:'status'})}
  stage('cancel-and-replace');await new Promise(r=>setTimeout(r,300));await present(complete);await wait(()=>dot!.status().phase==='playing');await dot.cancel();check('middle-cancel',dot.status().phase==='cancelled'&&(await telemetry()).some((e:any)=>e.type==='stop'))
  await new Promise(r=>setTimeout(r,300));await present(complete);await wait(()=>dot!.status().phase==='playing');const replacement=await present(short);await wait(()=>['completed','failed'].includes(dot!.status().phase));check('replacement-completes',dot.status().phase==='completed'&&dot.status().sequence===replacement.sequence)
  stage('failure-recovery');await new Promise(r=>setTimeout(r,300));await js('window.dotQa.failNextAudio=true');await present(short);await wait(()=>dot!.status().phase==='failed');check('renderer-failure-truthful',dot.status().error==='failed')
  await dot.cancel();await manage({type:'enabled',value:true});await manage({type:'prepare'});await new Promise(r=>setTimeout(r,300));await present(short);await wait(()=>['completed','failed'].includes(dot!.status().phase));check('recovery-after-failure',dot.status().phase==='completed')
  owner=false;await dot.cancel();await new Promise(r=>setTimeout(r,300));let blocked=false;try{await present(short)}catch(e){blocked=(e as Error).message==='DOT_UNAVAILABLE'}check('other-owner-rejected',blocked)
  result.status='PASS_ISOLATED_FULL_READING_ICL';result.finalStatus=dot.status();result.telemetry=await telemetry()
 }catch(error){result.status='FAIL';result.error=error instanceof Error?error.stack:String(error);result.dot=dot?.status();result.voiceError=controller?.service.snapshot().error}
 finally{
  if(monitor)clearInterval(monitor);await server?.close().catch(()=>{});await dot?.close().catch(()=>{});await controller?.close().catch(e=>result.cleanupError=String(e));win?.destroy();ipcMain.removeHandler('dot-qa.ready')
  await gpu().catch(()=>{});result.finishedAt=new Date().toISOString();await writeFile(join(root,'qa-result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({status:result.status,checks:result.checks,error:result.error,requiredFreeMiB:result.requiredFreeMiB}));app.exit(result.status==='PASS_ISOLATED_FULL_READING_ICL'?0:result.status==='FAIL'?1:2)
 }
}
void main().catch(e=>{console.error(e);app.exit(1)})
