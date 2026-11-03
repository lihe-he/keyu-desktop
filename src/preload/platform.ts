import { ipcRenderer } from 'electron'
let mayPlay=false
// No contextBridge and no public API: websites cannot access ipcRenderer.
ipcRenderer.on('campus:media-policy', (_event, allowed: boolean) => {
 mayPlay=allowed===true
 if(!mayPlay)for(const el of Array.from(document.querySelectorAll('video,audio')))(el as HTMLMediaElement).pause()
})
document.addEventListener('play', event => { if(!mayPlay && event.target instanceof HTMLMediaElement)event.target.pause() }, true)
