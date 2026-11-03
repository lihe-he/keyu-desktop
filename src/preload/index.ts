import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, Snapshot, Command } from '../shared/contracts'
const api:DesktopBridge={
 snapshot:()=>ipcRenderer.invoke('campus:snapshot'),
 command:(command:Command)=>ipcRenderer.invoke('campus:command',command),
 onSnapshot:(listener:(snapshot:Snapshot)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,data:Snapshot)=>listener(data);ipcRenderer.on('campus:snapshot-update',handler);return ()=>ipcRenderer.removeListener('campus:snapshot-update',handler)}
}
contextBridge.exposeInMainWorld('campus',Object.freeze(api))
