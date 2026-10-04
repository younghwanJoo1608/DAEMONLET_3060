import {afterEach,expect,it,vi} from 'vitest'
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {UUID} from 'builder-util-runtime'
import {APP_NAME,BUNDLE_ID,PROTOCOL_PORT,HOOK_PORT,UPDATE_CACHE_NAME} from '../electron/shared/app-identity.mjs'
import {BelleConnectionManager} from '../electron/main/dot/BelleConnectionManager'
import {BelleConnectionMetadata} from '../electron/main/dot/BelleConnectionMetadata'
import {CharacterVoiceService} from '../electron/main/character-voice/CharacterVoiceService'
import {ManagedRuntimeTerms} from '../electron/main/character-voice/ManagedRuntimeTerms'
import {DotPresentationService} from '../electron/main/dot/DotPresentationService'
import {emptyChat} from '../electron/shared/character-chat-semantics'
import catalog from '../electron/voice/managed-gguf-runtime-catalog.json'
const roots:string[]=[],clean:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const fn of clean.splice(0))await fn();for(const root of roots.splice(0)){expect(root.startsWith(join(tmpdir(),'daemonlet-update-'))).toBe(true);await rm(root,{recursive:true,force:true})}})
async function fixture(){const root=await mkdtemp(join(tmpdir(),'daemonlet-update-'));roots.push(root);return root}
it('keeps the installed 0.8.4 fork identity and deterministic NSIS upgrade GUID',async()=>{
 expect({APP_NAME,BUNDLE_ID,PROTOCOL_PORT,HOOK_PORT,UPDATE_CACHE_NAME}).toEqual({APP_NAME:'Daemonlet 3060',BUNDLE_ID:'io.github.younghwanjoo1608.daemonlet3060',PROTOCOL_PORT:4674,HOOK_PORT:4675,UPDATE_CACHE_NAME:'daemonlet-3060-updater'})
 expect(String(UUID.v5(BUNDLE_ID,UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')))).toBe('6cd36946-74d2-50c7-ab39-99db71ee5c6e')
 const source=await readFile('electron/native/windows/belle-credential.c','utf8')
 expect(source).toContain('io.github.younghwanjoo1608.daemonlet3060.belle-connection.runtime-v1')
 const desktop=await readFile('electron/main/DesktopIdentity.ts','utf8');expect(desktop).toContain('join(app.getPath("appData"), name)');expect(desktop).toContain('DAEMONLET_3060_DATA_HOME')
 const pkg=JSON.parse(await readFile('package.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8'))
 expect(pkg.version).toBe('0.8.5');expect(lock.version).toBe(pkg.version);expect(lock.packages[''].version).toBe(pkg.version)
})
it('keeps NSIS user-data preservation, current-user scope and no-force-close behavior',async()=>{
 const installer=await readFile('scripts/release/installer.mjs','utf8'),oldVersion=await readFile('node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh','utf8'),uninstaller=await readFile('node_modules/app-builder-lib/templates/nsis/uninstaller.nsh','utf8')
 expect(installer).toContain('deleteAppDataOnUninstall: false');expect(installer).toContain('perMachine: false');expect(installer).toContain('allowElevation: false');expect(installer).toContain('runAfterFinish: false')
 expect(installer).toContain('appId: BUNDLE_ID, productName: APP_NAME');expect(installer).not.toMatch(/CredDelete|--delete-app-data/)
 expect(oldVersion).toContain('StrCpy $0 "$0 --updated"');expect(uninstaller).toContain('StrCpy $isDeleteAppData "0"')
 const guard=await readFile('scripts/release/nsis-no-force-close.nsh','utf8');expect(guard).not.toMatch(/TerminateProcess|taskkill|nsProcess::KillProcess/);expect(guard).toContain('SetErrorLevel 32')
})
it.each([false,true])('reuses saved connection and mocked credential without rewriting it (autoConnect=%s)',async autoConnect=>{
 const root=await fixture(),config={tunnelId:'tunnel_'+'a'.repeat(32),organizationId:'org-syntheticupdate',consentVersion:1,autoConnect},path=join(root,'belle-connection.json'),before=JSON.stringify(config)+'\n'
 await writeFile(path,before);const metadata=new BelleConnectionMetadata(root),save=vi.spyOn(metadata,'save')
 const store={kind:'windows-credential-manager' as const,available:vi.fn(async()=>true),has:vi.fn(async()=>true),get:vi.fn(async()=> 'sk-'+'synthetic'.repeat(4)),put:vi.fn(async()=>{}),remove:vi.fn(async()=>{})}
 const running={stop:vi.fn(async()=>{}),ready:vi.fn(async()=>true)},runtime={probe:vi.fn(async()=>({clientVersion:'0.0.14',nodeVersion:'v24.21.0'})),start:vi.fn(async(_config:unknown)=>running)},bridge={start:vi.fn(async()=>({port:12345,token:'synthetic-session'})),stop:vi.fn(async()=>{})}
 const manager=new BelleConnectionManager({store,metadata,runtime,bridge});clean.push(()=>manager.close());await manager.initialize()
 if(autoConnect){await vi.waitFor(()=>expect(manager.snapshot().state).toBe('ready'));expect(runtime.start.mock.calls[0]?.[0]).toEqual(config)}else{expect(store.get).not.toHaveBeenCalled();expect(runtime.start).not.toHaveBeenCalled()}
 expect(manager.snapshot().config).toEqual(config);expect(manager.snapshot().muted).toBe(true)
 await manager.close();expect(save).not.toHaveBeenCalled();expect(store.put).not.toHaveBeenCalled();expect(store.remove).not.toHaveBeenCalled();expect(await readFile(path,'utf8')).toBe(before)
})
it.each([false,true])('loads existing voice choices without rewriting settings or retained assets (enabled=%s)',async enabled=>{
 const root=await fixture(),key='wav-'+'a'.repeat(36)+'@'+'b'.repeat(64),settings={version:1,engine:'qwen3-tts-06b-gguf',enabled,autoRead:false,volume:.37,bindings:{synthetic:key},executionProfile:'gguf-cuda-f16',qwenGgufExecutionProfile:'qwen-gguf',qwenClone:{mode:'icl',transcript:'A synthetic reference transcript.'},qwenGgufRuntime:{python:join(root,'runtime','python.exe'),model:join(root,'models'),ggufRuntime:join(root,'runtime')},seedSettings:{mode:'fixed',fixedSeed:42}},path=join(root,'settings.json'),before=JSON.stringify(settings)+'\n'
 await writeFile(path,before);const assets=['models/retained-model.fixture','reference-profiles/retained-reference.fixture','rt/retained-runtime.fixture']
 for(const p of assets){await mkdir(join(root,p,'..'),{recursive:true});await writeFile(join(root,p),'synthetic retained asset')}
 const makeRuntime=vi.fn(()=>{throw Error('NATIVE_RUNTIME_MUST_NOT_START')})
 const service=new CharacterVoiceService(root,'/synthetic-worker',()=>({epoch:1,character:{id:'synthetic',revision:'1'},model:'synthetic',conversation:null}) as any,()=>{},()=>{},makeRuntime);clean.push(()=>service.close())
 await service.initialize();expect(service.snapshot()).toMatchObject({engine:settings.engine,enabled,autoRead:false,volume:.37,qwenClone:settings.qwenClone,bindings:settings.bindings,seedSettings:settings.seedSettings});expect(makeRuntime).not.toHaveBeenCalled()
 const dot=new DotPresentationService(()=>({characterId:'synthetic',revision:'1',definition:emptyChat()}),()=>{},async()=>{throw Error('MUTED')},async()=>{});await dot.present({type:'present',text:'A complete synthetic answer.',speechText:'A complete synthetic answer.',speak:true,speechMode:'complete'});expect(dot.status().muted).toBe(true);await dot.close();await service.close()
 expect(await readFile(path,'utf8')).toBe(before);for(const p of assets)expect(await readFile(join(root,p),'utf8')).toBe('synthetic retained asset')
})
it('recognizes an unchanged existing terms receipt without accepting or rewriting it',async()=>{
 const root=await fixture(),terms=new ManagedRuntimeTerms(root,resolve('electron/voice/runtime-terms'),catalog as any),path=join(root,'managed-runtime-terms.json'),before=JSON.stringify({version:1,fingerprint:terms.fingerprint,acceptedAt:'2026-01-01T00:00:00Z'})+'\n'
 await writeFile(path,before);await terms.initialize();expect(terms.snapshot('qwen-cuda').accepted).toBe(true);expect(()=>terms.assertAccepted()).not.toThrow();expect(await readFile(path,'utf8')).toBe(before)
})
