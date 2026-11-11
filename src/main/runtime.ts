import { BrowserWindow, WebContentsView, session, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import type { Account, Course, Task, Chapter, PlatformId, RuntimeInfo, Bounds, Observation } from '../shared/contracts'
import { platformOf } from '../shared/platforms'
import { isAllowedUrl, isDirectoryCourse, partitionFor, safeUrl } from './core/security'
import type { PlaybackRuntime } from './core/engine'
import { PlatformAdapter } from './adapters/adapter'
import { blockedNavigationMessage, pageLoadFailure, courseHttpsRetry, type NavigationStage } from './core/navigation'
interface Entry { view: WebContentsView; accountId: string; platform: PlatformId; taskId: string|null; generation: number; mode:'browse'|'task'; visible:boolean; allowedToPlay:boolean; expectedUrl:string; navigationChanged:boolean; browsingCourseId?:string }
interface NavigationAttempt {entry:Entry;generation:number;controller:AbortController;source:string;loginPage:boolean;blocker?:string;secureRetry?:string}
class NavigationTimeoutError extends Error {constructor(){super('平台页面加载超时，请检查网络或稍后重试。')}}
export class BrowserRuntime implements PlaybackRuntime {
 private entries=new Map<PlatformId,Entry>();private sessions=new Map<string,Session>();private popups=new Map<string,Set<BrowserWindow>>();private displayed:PlatformId|null=null;private lastBounds:Bounds|null=null
 private navigationIssues=new WeakMap<WebContents,{pending?:NavigationAttempt}>()
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
  const issues:{pending?:NavigationAttempt}={};this.navigationIssues.set(contents,issues)
  const block=(event:Electron.Event,url:string,isMainFrame:boolean,stage:NavigationStage)=>{if(!isAllowedUrl(account.platform,url)){
   event.preventDefault();const attempt=issues.pending
   if(isMainFrame&&stage==='redirect'&&attempt){const retry=courseHttpsRetry(account.platform,attempt.source,url);if(retry){attempt.secureRetry=retry;return}}
   const loginPage=attempt?.loginPage??(account.platform==='chaoxing'&&/^https:\/\/passport2\.chaoxing\.com\/login(?:[?#]|$)/.test(contents.getURL()))
   const message=blockedNavigationMessage(account.platform,url,isMainFrame,stage,loginPage)
   if(isMainFrame&&attempt)attempt.blocker=message;this.warn(message)
  }}
  contents.on('will-frame-navigate',event=>{if(event.isMainFrame)this.cancelNavigation(contents,true);block(event,event.url,event.isMainFrame,'navigate')})
  contents.on('will-navigate',(event,url)=>{this.cancelNavigation(contents,true);block(event,url,true,'navigate')})
  contents.on('will-redirect',event=>block(event,event.url,event.isMainFrame,'redirect'))
  contents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)this.warn(issues.pending?.blocker??pageLoadFailure({errno:code}))})
  contents.once('destroyed',()=>this.cancelNavigation(contents))
  contents.on('render-process-gone',()=>this.cancelNavigation(contents))
  contents.setWindowOpenHandler(({url})=>{
   if(!isAllowedUrl(account.platform,url)){this.warn(blockedNavigationMessage(account.platform,url,true,'new-window',false));return {action:'deny'}}
   // Only browsing/login can open a controlled authentication window.
   if(isPopup||this.entries.get(account.platform)?.mode==='task'){this.warn('学习任务请求新窗口，请暂停任务后在工作台人工处理。');return {action:'deny'}}
   // A directory course is a normal course page, not an authentication popup.
   // Keep it in the scheduled account's view; never persist the signed address.
   const entry=this.entries.get(account.platform)
   if(entry?.accountId===account.id&&isDirectoryCourse(account.platform,url)){
    entry.browsingCourseId=undefined;void this.load(entry,url).catch(error=>this.warn(error instanceof Error?error.message:'课程入口未能加载，请返回“我学的课”后重试。'));return {action:'deny'}
   }
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
  view.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)entry.browsingCourseId=undefined})
  view.webContents.on('did-navigate',(_event,url)=>{if(entry.mode==='task'&&entry.expectedUrl&&url!==entry.expectedUrl)entry.navigationChanged=true;this.changed()})
  view.webContents.on('did-navigate-in-page',(_event,url,isMainFrame)=>{if(isMainFrame&&entry.mode==='task'&&entry.expectedUrl&&url!==entry.expectedUrl)entry.navigationChanged=true;this.changed()})
  view.webContents.on('render-process-gone',()=>{entry.allowedToPlay=false;this.warn('平台页面进程已退出，对应任务将在状态检查时暂停。');this.changed()})
  view.webContents.on('unresponsive',()=>this.warn('平台页面暂时无响应，任务将停止自动推进。'))
  this.changed();return entry
 }
 private ownsNavigation(attempt:NavigationAttempt):boolean {
  const entry=attempt.entry,contents=entry.view.webContents
  return this.entries.get(entry.platform)===entry&&entry.generation===attempt.generation&&!contents.isDestroyed()&&!attempt.controller.signal.aborted&&this.navigationIssues.get(contents)?.pending===attempt
 }
 private assertNavigation(attempt:NavigationAttempt):void {if(!this.ownsNavigation(attempt))throw new Error('页面操作已取消。')}
 private releaseNavigation(attempt:NavigationAttempt):void {attempt.source='';attempt.secureRetry=undefined;attempt.blocker=undefined;attempt.controller.abort()}
 private cancelNavigation(contents:WebContents,stop=false):void {
  const issues=this.navigationIssues.get(contents),attempt=issues?.pending;if(!attempt)return
  const shouldStop=stop&&this.ownsNavigation(attempt)
  if(issues)issues.pending=undefined;this.releaseNavigation(attempt)
  if(shouldStop)contents.stop()
 }
 private async loadNavigation(attempt:NavigationAttempt,url:string):Promise<void>{
  this.assertNavigation(attempt)
  const contents=attempt.entry.view.webContents,signal=attempt.controller.signal
  let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{}
  try{
   const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new Error('页面操作已取消。'));signal.addEventListener('abort',abort,{once:true})})
   const timedOut=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{
    if(!this.ownsNavigation(attempt)){reject(new Error('页面操作已取消。'));return}
    // Promise.race alone does not stop Chromium. Revoke the signed retry before
    // stopping only this attempt's still-current navigation.
    attempt.source='';attempt.secureRetry=undefined;reject(new NavigationTimeoutError());contents.stop()
   },30000)})
   await Promise.race([contents.loadURL(url),cancelled,timedOut]);this.assertNavigation(attempt)
  }finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort)}
 }
 private async load(entry:Entry,url:string):Promise<void>{
  if(!isAllowedUrl(entry.platform,url))throw new Error('课程地址不在该平台允许的范围内。')
  const contents=entry.view.webContents,issues=this.navigationIssues.get(contents)
  this.cancelNavigation(contents)
  const attempt:NavigationAttempt={entry,generation:entry.generation,controller:new AbortController(),source:url,loginPage:entry.platform==='chaoxing'&&/^https:\/\/passport2\.chaoxing\.com\/login(?:[?#]|$)/.test(url)}
  if(issues)issues.pending=attempt
  try{
   try{await this.loadNavigation(attempt,url)}catch(error){
    this.assertNavigation(attempt)
    const retry=attempt.secureRetry
    if(!retry)throw error instanceof NavigationTimeoutError?error:new Error(attempt.blocker??pageLoadFailure(error))
    // A single HTTPS attempt in the same account session. Further redirects
    // cannot schedule another retry; signed addresses remain local to this load.
    attempt.source='';attempt.secureRetry=undefined;attempt.blocker=undefined
    try{await this.loadNavigation(attempt,retry)}catch(error){this.assertNavigation(attempt);throw error instanceof NavigationTimeoutError?error:new Error(attempt.blocker??pageLoadFailure(error))}
   }
   this.assertNavigation(attempt)
  }finally{if(issues?.pending===attempt)issues.pending=undefined;this.releaseNavigation(attempt)}
 }
 async browse(account:Account,url=platformOf(account.platform).home):Promise<void>{
  const existing=this.entries.get(account.platform)
  if(existing?.mode==='task')throw new Error('该平台正在保留学习任务。请先暂停或取消任务，再浏览其他账号或课程。')
  const entry=existing?.accountId===account.id?existing:this.create(account,'browse')
  entry.browsingCourseId=undefined
  await this.load(entry,url);this.changed()
 }
 courseIsOpen(accountId:string,courseId:string):boolean {
  const entry=this.entries.get(this.account(accountId).platform)
  return !!entry&&entry.accountId===accountId&&entry.mode==='browse'&&entry.browsingCourseId===courseId&&!entry.view.webContents.isDestroyed()
 }
 async browseCourse(account:Account,course:Course):Promise<void>{
  const current=this.entries.get(account.platform)
  if(current?.mode==='task')throw new Error('请先暂停该平台任务，再打开课程。')
  const contents=this.contentsForOrCreate(account,course),entryBefore=this.entries.get(account.platform),sourceUrl=contents.getURL()
  const url=await this.adapter(account.platform).resolveCourseUrl(contents,course)
  if(this.entries.get(account.platform)!==entryBefore||contents.isDestroyed()||contents.getURL()!==sourceUrl)throw new Error('账号页面已改变，请重试。')
  await this.browse(account,url)
  const entry=this.entries.get(account.platform)
  if(entry?.accountId===account.id)entry.browsingCourseId=course.id
 }
 private contentsForOrCreate(account:Account,course:Course):WebContents {
  const entry=this.entries.get(account.platform)
  if(entry?.accountId===account.id&&!entry.view.webContents.isDestroyed())return entry.view.webContents
  if(isDirectoryCourse(account.platform,course.url))throw new Error('请先打开此账号，在学习通“课程 → 我学的课”刷新后重试。')
  return this.create(account,'browse').view.webContents
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
   const target=chapter.target,probes=await adapter.read(contents)
   if(this.entries.get(task.platform)!==entry||entry.generation!==task.generation||contents.isDestroyed())return
   const issue=probes.find(p=>p.issue)?.issue;if(issue)throw new Error(issue)
   // The current frame, control and destination must all identify one chapter;
   // a stable title or index does not authorize a cached URL after link drift.
   const matches=probes.flatMap(p=>p.chapters).filter(c=>c.url===chapter.url&&c.target?.selector===target.selector&&c.target?.text===target.text&&c.target?.index===target.index&&c.target?.frameUrl===target.frameUrl)
   if(matches.length!==1)throw new Error('章节目录发生变化，无法确认目标，请重新读取课程。')
   const item=matches[0]
   if(item.locked)throw new Error('下一章节尚未解锁，请先在平台处理。')
   if(item.kind==='manual')throw new Error('当前章节需要人工处理，请先在平台处理，再重新读取章节。')
   const direct=chapter.url!==target.frameUrl
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
  this.cancelNavigation(e.view.webContents,true)
  e.browsingCourseId=undefined
  if(action==='home')await this.load(e,platformOf(platform).courses)
  else if(action==='reload')e.view.webContents.reload()
  else if(e.view.webContents.navigationHistory.canGoBack())e.view.webContents.navigationHistory.goBack()
 }
 close(platform:PlatformId,taskId?:string):void{
  const e=this.entries.get(platform);if(!e||taskId&&e.taskId!==taskId)return
  this.cancelNavigation(e.view.webContents)
  this.entries.delete(platform);try{this.window.contentView.removeChildView(e.view)}catch{}
  if(!e.view.webContents.isDestroyed())e.view.webContents.close({waitForBeforeUnload:false})
  this.changed()
 }
 async clearAccount(account:Account):Promise<void>{
  const e=this.entries.get(account.platform);if(e?.accountId===account.id)this.close(account.platform)
  for(const popup of this.popups.get(account.id)??[])popup.destroy();this.popups.delete(account.id)
  const ses=this.getSession(account);await ses.clearStorageData();await ses.clearCache();await ses.clearAuthCache();await ses.closeAllConnections()
 }
 info():RuntimeInfo[]{return [...this.entries.values()].map(e=>{const url=e.view.webContents.isDestroyed()?'':e.view.webContents.getURL();return {platform:e.platform,taskId:e.taskId,accountId:e.accountId,mode:e.mode,visible:e.visible,url:safeUrl(url),title:platformOf(e.platform).name,loginPending:e.platform==='chaoxing'&&/^https:\/\/passport2\.chaoxing\.com\/login(?:[?#]|$)/.test(url)}})}
 async guardBrowsing():Promise<void>{await Promise.all([...this.entries.values()].filter(e=>!e.allowedToPlay&&!e.view.webContents.isDestroyed()).map(e=>this.adapter(e.platform).operate(e.view.webContents,'pause').catch(()=>{})))}
 closeAll():void{for(const p of [...this.entries.keys()])this.close(p);for(const popups of this.popups.values())for(const p of popups)p.destroy();this.popups.clear()}
}
