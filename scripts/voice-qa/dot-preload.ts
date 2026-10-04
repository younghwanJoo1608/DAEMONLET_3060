import {contextBridge,ipcRenderer} from 'electron'
import {DOT_IPC} from '../../electron/shared/dot-presentation'
const on=(channel:string,callback:(v:any)=>void)=>{ipcRenderer.on(channel,(_e,v)=>callback(v))}
contextBridge.exposeInMainWorld('dotQaBridge',{
 action:(v:any)=>ipcRenderer.invoke(DOT_IPC.voiceAction,v),
 audio:(id:string,epoch:number)=>ipcRenderer.invoke(DOT_IPC.audio,id,epoch),
 volume:()=>ipcRenderer.invoke(DOT_IPC.volume),
 ready:()=>ipcRenderer.invoke('dot-qa.ready'),
 events:(f:(v:any)=>void)=>on(DOT_IPC.voiceEvent,f),
 frames:(f:(v:any)=>void)=>on(DOT_IPC.changed,f),
 volumes:(f:(v:any)=>void)=>on(DOT_IPC.volumeChanged,f),
})
