// Explicit development-only voice QA. No full AppController or release packaging.
import {build} from 'esbuild'
import {mkdir,writeFile,copyFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {requireElectronRuntime} from '../release/electron-runtime.mjs'
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]||'')
if(!process.argv[2]||out===root||out.startsWith(root+'\\')||out.startsWith(root+'/'))throw Error('QA_OUTPUT_MUST_BE_EXTERNAL')
await requireElectronRuntime(root)
await mkdir(out,{recursive:true})
const common={absWorkingDir:root,bundle:true,metafile:true,logLevel:'warning'},results=[]
for(const [entry,name] of [['scripts/voice-qa/main.ts','main.cjs'],['electron/preload/character-chat-preload.ts','preload.cjs'],['electron/utility/reference-import-worker.ts','reference-import-worker.cjs']])results.push(await build({...common,entryPoints:[entry],outfile:join(out,name),platform:'node',target:'node24',format:'cjs',external:['electron']}))
results.push(await build({...common,entryPoints:['scripts/voice-qa/renderer.tsx'],outfile:join(out,'renderer.js'),platform:'browser',target:'chrome150',format:'iife'}))
const inputs=[...new Set(results.flatMap(r=>Object.keys(r.metafile.inputs)))].sort()
const prohibited=inputs.filter(p=>/AppController|Credential|Tunnel|AutoStart|UpdateService|UpdateController|CharacterChatService\.ts/.test(p))
if(prohibited.length)throw Error('QA_SERVICE_ISOLATION_FAILED: '+prohibited.join(','))
await copyFile(join(out,'reference-import-worker.cjs'),join(out,'../voice/reference-import-worker.cjs'))
await writeFile(join(out,'bundle-inputs.json'),JSON.stringify({qaOnly:true,inputs,prohibited},null,2))
await writeFile(join(out,'character-chat.html'),'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; connect-src \'none\'"><title>Daemonlet isolated ICL QA</title><style>body{font:15px system-ui;margin:24px;max-width:900px}label,small{display:block;margin:8px 0}textarea{width:90%;height:80px}button,select{margin:5px;padding:7px}section{margin:20px 0}details{margin:14px 0}progress{width:80%}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>')
console.log(JSON.stringify({status:'PASS_VOICE_QA_BUILD',out,inputs:inputs.length,prohibited}))
