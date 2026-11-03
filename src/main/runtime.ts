import { BrowserWindow, WebContentsView, session, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import type { Account, Task, Chapter, PlatformId, RuntimeInfo, Bounds, Observation } from '../shared/contracts'
import { platformOf } from '../shared/platforms'
import { isAllowedUrl, partitionFor, safeUrl } from './core/security'
import type { PlaybackRuntime } from './core/engine'
import { PlatformAdapter, within } from './adapters/adapter'
interface Entry { view: WebContentsView; accountId: string; platform: PlatformId; taskId: string|null; generation: number; mode:'browse'|'task'; visible:boolean; allowedToPlay:boolean; expectedUrl:string; navigationChanged:boolean }
export class BrowserRuntime implements PlaybackRuntime {
 private entries=new Map<PlatformId,Entry>();private sessions=new Map<string,Session>();private popups=new Map<string,Set<BrowserWindow>>();private displayed:PlatformId|null=null;private lastBounds:Bounds|null=null
 constructor(private window: BrowserWindow, private account:(id:string)=>Account, private changed:()=>void, private warn:(message:string)=>void, private fixtureSetup?: (ses:Session,account:Account)=>void){}
 adapter(platform:PlatformId):PlatformAdapter {return new PlatformAdapter(platform)}
 getSession(account:Account):Session {
  let ses=this.sessions.get(account.id);if(ses)return ses
  ses=session.fromPartition(partitionFor(account.platform,account.id),{cache:true});this.sessions.set(account.id,ses)
  ses.setPermissionCheckHandler(()=>false);ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false))
  ses.on('will-download',event=>{event.preventDefault();this.warn('首版不支持资料下载，请使用系统浏览器下载。')})
  ses.webRequest.onBeforeRequest((details,callback)=>{
   if(details.resourceType==='media'){
    const entry=this.entries.get(account.platform)
    if(!entry||entry.accountId!==account.id||entry.mode!=='task'){callback({cancel:true});return}
   }
   callback({})
  })
  this.fixtureSetup?.(ses,account);return ses
 }
 private guard(contents:WebContents,account:Account,isPopup=false):void {
  const block=(event:Electron.Event,url:string)=>{if(!isAllowedUrl(account.platform,url)){event.preventDefault();this.warn('已阻止未验证的页面跳转。如学校使用特殊登录入口，需要先补充兼容性验证。')}}
  contents.on('will-frame-navigate',event=>block(event,event.url));contents.on('will-navigate',block);contents.on('will-redirect',block)
  contents.setWindowOpenHandler(({url})=>{
   if(!isAllowedUrl(account.platform,url)){this.warn('已阻止打开平台名单之外的窗口。');return {action:'deny'}}
   // Only browsing/login can open a controlled authentication window.
   if(isPopup||this.entries.get(account.platform)?.mode==='task'){this.warn('学习任务请求新窗口，请暂停任务后在工作台人工处理。');return {action:'deny'}}
   const existingPopup=[...(this.popups.get(account.id)??[])].find(w=>!w.isDestroyed());if(existingPopup){existingPopup.show();existingPopup.focus();return {action:'deny'}}
   const popup=new BrowserWindow({width:960,height:740,parent:this.window,show:false,autoHideMenuBar:true,webPreferences:{session:this.getSession(account),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:join(__dirname,'../preload/platform.js')}})
   const set=this.popups.get(account.id)??new Set<BrowserWindow>();set.add(popup);this.popups.set(account.id,set)
   this.guard(popup.webContents,account,true);popup.webContents.setAudioMuted(true)
   popup.on('closed',()=>set.delete(popup));popup.once('ready-to-show',()=>popup.show());void popup.loadURL(url).catch(()=>this.warn('登录窗口加载失败，请检查网络。'));return {action:'deny'}
  })
  contents.on('will-attach-webview',event=>event.preventDefault())
  contents.on('dom-ready',()=>{
   const entry=this.entries.get(account.platform);const enabled=!isPopup&&entry?.view.webContents===contents&&entry.allowedToPlay
   contents.send('campus:media-policy',!!enabled)
  })
 }
 private create(account:Account,mode:'browse'|'task',task?:Task):Entry {
  this.close(account.platform)
  for(const [id,popups] of this.popups)if(this.account(id).platform===account.platform){for(const popup of popups)popup.destroy();this.popups.delete(id)}
  const view=new WebContentsView({webPreferences:{session:this.getSession(account),preload:join(__dirname,'../preload/platform.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:true,allowRunningInsecureContent:false}})
  const entry:Entry={view,accountId:account.id,platform:account.platform,taskId:task?.id??null,generation:task?.generation??0,mode,visible:false,allowedToPlay:false,expectedUrl:'',navigationChanged:false}
  this.entries.set(account.platform,entry);this.window.contentView.addChildView(view);view.setVisible(false);view.setBounds({x:0,y:0,width:1000,height:650});view.webContents.setAudioMuted(true);this.guard(view.webContents,account)
  view.webContents.on('did-navigate',(_event,url)=>{if(entry.mode==='task'&&entry.expectedUrl&&url!==entry.expectedUrl)entry.navigationChanged=true;this.changed()})
  view.webContents.on('did-navigate-in-page',(_event,url,isMainFrame)=>{if(isMainFrame&&entry.mode==='task'&&entry.expectedUrl&&url!==entry.expectedUrl)entry.navigationChanged=true;this.changed()})
  view.webContents.on('render-process-gone',()=>{entry.allowedToPlay=false;this.warn('平台页面进程已退出，对应任务将在状态检查时暂停。');this.changed()})
  view.webContents.on('unresponsive',()=>this.warn('平台页面暂时无响应，任务将停止自动推进。'))
  this.changed();return entry
 }
 private async load(entry:Entry,url:string):Promise<void>{
  if(!isAllowedUrl(entry.platform,url))throw new Error('课程地址不在该平台允许的范围内。')
  try{await within(entry.view.webContents.loadURL(url),30000)}catch{throw new Error('平台页面未能加载，请检查网络或稍后重试。')}
  if(this.entries.get(entry.platform)!==entry||entry.view.webContents.isDestroyed())throw new Error('页面操作已取消。')
 }
 async browse(account:Account,url=platformOf(account.platform).home):Promise<void>{
  const existing=this.entries.get(account.platform)
  if(existing?.mode==='task')throw new Error('该平台正在保留学习任务。请先暂停或取消任务，再浏览其他账号或课程。')
  const entry=existing?.accountId===account.id?existing:this.create(account,'browse')
  await this.load(entry,url);this.changed()
 }
 async open(task:Task,chapter:Chapter):Promise<void>{
  const account=this.account(task.accountId);const previous=this.entries.get(task.platform)
  // Preserve the current DOM for in-page chapter controls; do not reload and trust an old index.
  let entry:Entry
  if(previous?.taskId===task.id&&previous.accountId===task.accountId&&!previous.view.webContents.isDestroyed()){
   entry=previous;entry.generation=task.generation;entry.allowedToPlay=false;entry.expectedUrl='';entry.navigationChanged=false
   entry.view.webContents.setAudioMuted(true);entry.view.webContents.send('campus:media-policy',false)
  }else entry=this.create(account,'task',task)
  const contents=entry.view.webContents;const adapter=this.adapter(task.platform)
  const courseUrl=chapter.target?.frameUrl??chapter.url
  const hasTargetFrame=contents.mainFrame.framesInSubtree.some(f=>f.url===courseUrl)
  if(!hasTargetFrame)await this.load(entry,courseUrl)
  if(this.entries.get(task.platform)!==entry||entry.generation!==task.generation)return
  if(chapter.target){
   const probes=await adapter.read(contents);const item=probes.flatMap(p=>p.chapters).find(c=>c.target?.selector===chapter.target?.selector&&c.target?.text===chapter.target?.text&&c.target?.index===chapter.target?.index)
   if(!item)throw new Error('章节目录发生变化，无法确认目标，请重新读取课程。')
   if(item.locked)throw new Error('下一章节尚未解锁，请先在平台处理。')
   const direct=chapter.url!==chapter.target.frameUrl
   if(direct)await this.load(entry,chapter.url)
   else {await adapter.operate(contents,'click',chapter);await new Promise(resolve=>setTimeout(resolve,1200))}
  }
  if(this.entries.get(task.platform)!==entry||entry.generation!==task.generation)return
  entry.expectedUrl=contents.getURL();entry.navigationChanged=false
  // Allow bounded DOM/player initialization without refreshing or falsifying visibility.
  for(const delay of [0,400,800,1600,2400]){
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay))
   if(this.entries.get(task.platform)!==entry||entry.generation!==task.generation||contents.isDestroyed())return
   const observation=await adapter.observation(contents,task)
   if(observation.issue||observation.state!=='unknown')break
  }
  if(this.displayed===task.platform&&this.lastBounds)this.show(task.platform,this.lastBounds)
  this.changed()
 }
 async play(task:Task):Promise<void>{
  const e=this.forTask(task);if(e.generation!==task.generation)throw new Error('任务已被取消或替换。')
  e.allowedToPlay=true;e.view.webContents.send('campus:media-policy',true)
  await this.adapter(task.platform).operate(e.view.webContents,'play')
 }
 async pause(task:Task):Promise<void>{
  const e=this.entries.get(task.platform);if(!e||e.taskId!==task.id)return
  e.allowedToPlay=false;e.generation=task.generation;e.view.webContents.setAudioMuted(true);e.view.webContents.send('campus:media-policy',false)
  await this.adapter(task.platform).operate(e.view.webContents,'pause')
 }
 async observe(task:Task):Promise<Observation>{
  const e=this.forTask(task);if(e.navigationChanged)throw new Error('课程页面已被手动切换。')
  return this.adapter(task.platform).observation(e.view.webContents,task)
 }
 private forTask(task:Task):Entry{const e=this.entries.get(task.platform);if(!e||e.taskId!==task.id||e.view.webContents.isDestroyed())throw new Error('任务页面已经关闭。');return e}
 contentsFor(accountId:string):WebContents {const account=this.account(accountId);const e=this.entries.get(account.platform);if(!e||e.accountId!==accountId||e.view.webContents.isDestroyed())throw new Error('请先在学习工作台打开这个账号。');return e.view.webContents}
 show(platform:PlatformId,bounds:Bounds):void{
  const [width,height]=this.window.getContentSize();const clamped={x:Math.max(0,bounds.x),y:Math.max(0,bounds.y),width:Math.max(1,Math.min(bounds.width,width-bounds.x)),height:Math.max(1,Math.min(bounds.height,height-bounds.y))}
  this.displayed=platform;this.lastBounds=clamped
  for(const [p,e]of this.entries){e.visible=p===platform&&!this.window.isMinimized()&&this.window.isVisible();if(e.visible)e.view.setBounds(clamped);e.view.setVisible(e.visible)}
 }
 hide():void{this.displayed=null;for(const e of this.entries.values()){e.visible=false;e.view.setVisible(false)}}
 windowHidden():void{for(const e of this.entries.values()){e.visible=false;e.view.setVisible(false)}}
 windowShown():void{if(this.displayed&&this.lastBounds)this.show(this.displayed,this.lastBounds)}
 setAudio(muteAll:boolean,audible:PlatformId):void{for(const e of this.entries.values())if(!e.view.webContents.isDestroyed())e.view.webContents.setAudioMuted(muteAll||e.platform!==audible||!e.allowedToPlay)}
 async navigate(platform:PlatformId,action:'back'|'reload'|'home'):Promise<void>{
  const e=this.entries.get(platform);if(!e)throw new Error('请先打开账号或课程。');if(e.mode==='task')throw new Error('请先暂停任务，避免导航导致章节混淆。')
  if(action==='home')await this.load(e,platformOf(platform).courses)
  else if(action==='reload')e.view.webContents.reload()
  else if(e.view.webContents.navigationHistory.canGoBack())e.view.webContents.navigationHistory.goBack()
 }
 close(platform:PlatformId,taskId?:string):void{
  const e=this.entries.get(platform);if(!e||taskId&&e.taskId!==taskId)return
  this.entries.delete(platform);try{this.window.contentView.removeChildView(e.view)}catch{}
  if(!e.view.webContents.isDestroyed())e.view.webContents.close({waitForBeforeUnload:false})
  this.changed()
 }
 async clearAccount(account:Account):Promise<void>{
  const e=this.entries.get(account.platform);if(e?.accountId===account.id)this.close(account.platform)
  for(const popup of this.popups.get(account.id)??[])popup.destroy();this.popups.delete(account.id)
  const ses=this.getSession(account);await ses.clearStorageData();await ses.clearCache();await ses.clearAuthCache();await ses.closeAllConnections()
 }
 info():RuntimeInfo[]{return [...this.entries.values()].map(e=>({platform:e.platform,taskId:e.taskId,accountId:e.accountId,mode:e.mode,visible:e.visible,url:safeUrl(e.view.webContents.isDestroyed()?'':e.view.webContents.getURL()),title:platformOf(e.platform).name}))}
 async guardBrowsing():Promise<void>{await Promise.all([...this.entries.values()].filter(e=>!e.allowedToPlay&&!e.view.webContents.isDestroyed()).map(e=>this.adapter(e.platform).operate(e.view.webContents,'pause').catch(()=>{})))}
 closeAll():void{for(const p of [...this.entries.keys()])this.close(p);for(const popups of this.popups.values())for(const p of popups)p.destroy();this.popups.clear()}
}
