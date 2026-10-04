import {afterEach,expect,it,vi} from 'vitest'
import {createServer} from 'node:net'
import {request} from 'node:http'
import {DotBridgeServer,dotBridgeConfig} from '../electron/main/dot/DotBridgeServer'
import {DotPresentationService} from '../electron/main/dot/DotPresentationService'
import {emptyChat} from '../electron/shared/character-chat-semantics'
import {localForward} from '../scripts/dot-presentation-mcp.mjs'
const clean:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const fn of clean.splice(0))await fn()})
async function fixture(){const port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=(s.address() as any).port;s.close(()=>resolve(port))})});const service=new DotPresentationService(()=>({characterId:'c',revision:'r',definition:emptyChat()}),()=>{},async()=>{},async()=>{}),server=new DotBridgeServer(service),token='a'.repeat(32);await server.start({port,token});clean.push(async()=>{await server.close();await service.close()});return {port,token,service,server,url:`http://127.0.0.1:${port}/present`,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}}}
it('defaults off and refuses weak tokens or public port configuration',()=>{expect(dotBridgeConfig({})).toBeNull();expect(()=>dotBridgeConfig({DAEMONLET_3060_DOT_BRIDGE:'1'})).toThrow('DOT_CONFIG');expect(dotBridgeConfig({DAEMONLET_3060_DOT_BRIDGE:'1',DAEMONLET_3060_DOT_TOKEN:'a'.repeat(32)})).toMatchObject({port:39531})})
it('local MCP forwarder reaches the authenticated app and cancellation clears it',async()=>{const f=await fixture(),forward=localForward({DAEMONLET_3060_DOT_PORT:String(f.port),DAEMONLET_3060_DOT_TOKEN:f.token});expect(await forward({type:'present',text:'hello'})).toMatchObject({accepted:true,voice:'off'});expect(f.service.snapshot()?.text).toBe('hello');await forward({type:'cancel'});const status=await new Promise<number>(resolve=>{const req=request(f.url,{method:'POST',headers:{...f.headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode!)});req.end(JSON.stringify({type:'present',text:'x'}))});expect(status).toBe(403);expect(f.service.snapshot()).toBeNull()})
it('rejects browser origins and missing auth before any presentation',async()=>{const f=await fixture();for(const headers of [{'Content-Type':'application/json'},{...f.headers,Origin:'https://evil.example'}]){const r=await fetch(f.url,{method:'POST',headers,body:JSON.stringify({type:'present',text:'x'})});expect(r.status).toBe(403)}expect(f.service.snapshot()).toBeNull()})
it('caps bodies and request rate while allowing immediate cancellation',async()=>{const f=await fixture();const send=(body:string)=>fetch(f.url,{method:'POST',headers:f.headers,body});expect((await send('x'.repeat(96*1024+1))).status).toBe(413);expect((await send(JSON.stringify({type:'present',text:'x'}))).status).toBe(200);expect((await send(JSON.stringify({type:'present',text:'y'}))).status).toBe(429);expect((await send(JSON.stringify({type:'cancel'}))).status).toBe(200)})

it('app-owned connection uses a random loopback port with exact Host authentication',async()=>{const service=new DotPresentationService(()=>({characterId:'c',revision:'r',definition:emptyChat()}),()=>{},async()=>{},async()=>{}),server=new DotBridgeServer(service),token='a'.repeat(32);const port=await server.start({port:0,token});clean.push(async()=>{await server.close();await service.close()});expect(port).toBeGreaterThan(0);const forward=localForward({DAEMONLET_3060_DOT_PORT:String(port),DAEMONLET_3060_DOT_TOKEN:token});expect(await forward({type:'present',text:'owned'})).toMatchObject({accepted:true});await forward({type:'cancel'})})

it('accepts one full escaped body and exposes authenticated text-free status without changing it',async()=>{
 const f=await fixture(),text='가'.repeat(6000),body=JSON.stringify({type:'present',text,speechText:text,speak:true,speechMode:'complete'}).replaceAll('가','\\uac00')
 const response=await fetch(f.url,{method:'POST',headers:f.headers,body});expect(response.status).toBe(200);expect(f.service.snapshot()?.text).toBe(text)
 const before=f.service.snapshot(),forward=localForward({DAEMONLET_3060_DOT_PORT:String(f.port),DAEMONLET_3060_DOT_TOKEN:f.token})
 const status=await forward({type:'status'});expect(status).toMatchObject({phase:'displaying',muted:true});expect(JSON.stringify(status)).not.toContain('가');expect(f.service.snapshot()).toEqual(before)
 const invalid=await fetch(f.url,{method:'POST',headers:f.headers,body:JSON.stringify({type:'status',extra:true})});expect(invalid.status).toBe(400)
})

it('bounds status polling independently without delaying present or cancel',async()=>{
 const f=await fixture(),send=(value:unknown)=>fetch(f.url,{method:'POST',headers:f.headers,body:JSON.stringify(value)})
 expect((await send({type:'status'})).status).toBe(200)
 expect((await send({type:'status'})).status).toBe(429)
 expect((await send({type:'present',text:'new'})).status).toBe(200)
 expect((await send({type:'cancel'})).status).toBe(200)
 expect(f.service.status().phase).toBe('cancelled')
})
