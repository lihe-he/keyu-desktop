import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, Notification, dialog, powerMonitor, type IpcMainInvokeEvent } from 'electron'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Command, Result, Snapshot, Notice, Account, Chapter } from '../shared/contracts'
import { platformIds } from '../shared/contracts'
import { platforms, platformOf } from '../shared/platforms'
import { commandSchema } from '../shared/validation'
import { trustedSender, redact, fingerprint } from './core/security'
import { Store } from './store'
import { BrowserRuntime } from './runtime'
import { TaskEngine } from './core/engine'
import { aggregateIntervals, localDayStart } from './core/stats'
import { ReminderService } from './core/reminders'
import { setupFixtureSession } from './testing/fixtures'
import { verificationProfilePath } from './core/verification-profile'
const fixtureMode=!app.isPackaged&&process.env.CAMPUS_TEST_MODE==='1'
const customData=!app.isPackaged?process.env.CAMPUS_USER_DATA:undefined
if(app.commandLine.hasSwitch('campus-verification-profile')){
 const path=verificationProfilePath(app.commandLine.getSwitchValue('campus-verification-profile'),app.getPath('temp'))
 mkdirSync(path,{recursive:true});app.setPath('userData',path)
}
else if(customData&&isAbsolute(customData))app.setPath('userData',customData)
else app.setPath('userData',join(app.getPath('appData'),'CampusCourseDesktop'))
app.setAppUserModelId('cn.campuscourse.desktop')
if(!fixtureMode&&!app.requestSingleInstanceLock()){app.quit()}else{void app.whenReady().then(boot).catch(error=>{dialog.showErrorBox('网课助手无法启动','未修改或清空你的数据。请保留数据目录并联系开发者。\n'+redact(String(error)));app.exit(1)})}
async function boot():Promise<void>{
 const store=new Store(join(app.getPath('userData'),'campus.sqlite3'))
 const icon=join(__dirname,'../../resources/icon.png')
 const window=new BrowserWindow({width:1340,height:880,minWidth:1080,minHeight:720,show:false,backgroundColor:'#f6f8fb',title:'网课助手',autoHideMenuBar:true,icon,webPreferences:{preload:join(__dirname,'../preload/index.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged}})
 Menu.setApplicationMenu(null)
 let lifecycle:Snapshot['lifecycle']='ready';let quitting=false;let readyToQuit=false;let flushTimer:ReturnType<typeof setTimeout>|null=null
 let snapshotSequence=0
 const chapters=new Map<string,Chapter[]>();const accountBusy=new Set<string>()
 const account=(id:string):Account=>{const a=store.accounts().find(a=>a.id===id);if(!a)throw new Error('账号不存在，请刷新界面。');return a}
 let runtime:BrowserRuntime;let engine:TaskEngine
 function snapshot():Snapshot{
  const now=Date.now(),today=localDayStart(now),tasks=store.tasks();return {sequence:++snapshotSequence,accounts:store.accounts(),courses:store.courses(),tasks,notices:store.notices(),settings:store.settings(),platforms,views:runtime?.info()??[],stats:{...aggregateIntervals(store.intervals(today),today,now),todayFinished:tasks.filter(t=>t.status==='finished'&&t.updatedAt>=today).length},version:app.getVersion(),fixtureMode,lifecycle}
 }
 function broadcast():void{if(flushTimer||quitting)return;flushTimer=setTimeout(()=>{flushTimer=null;if(!window.isDestroyed()){const s=store.settings();runtime?.setAudio(s.muteAll,s.audiblePlatform);window.webContents.send('campus:snapshot-update',snapshot())}},100)}
 function notify(n:Notice):void{if(Notification.isSupported()){const notification=new Notification({title:n.title,body:n.body,silent:true});notification.on('click',()=>{window.show();window.focus()});notification.show()}broadcast()}
 function warn(message:string):void{const recent=store.notices().find(n=>n.body===message&&Date.now()-n.createdAt<30000);if(recent)return;const n:Notice={id:randomUUID(),level:'warning',title:'需要你确认',body:message,createdAt:Date.now(),read:false};store.saveNotice(n);notify(n)}
 runtime=new BrowserRuntime(window,account,broadcast,warn,fixtureMode?setupFixtureSession:undefined)
 engine=new TaskEngine(store,runtime,broadcast,notify);engine.restore()
 const reminders=new ReminderService(store,notify)
 const expectedUrl=process.env.ELECTRON_RENDERER_URL&&!app.isPackaged?process.env.ELECTRON_RENDERER_URL:pathToFileURL(join(__dirname,'../renderer/index.html')).href
 const authorize=(event:IpcMainInvokeEvent):void=>{if(!trustedSender(event.sender.id,window.webContents.id,event.senderFrame===event.sender.mainFrame,event.senderFrame?.url??'',expectedUrl))throw new Error('请求来源未经授权。')}
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(url!==expectedUrl)event.preventDefault()})
 window.webContents.on('will-attach-webview',event=>event.preventDefault());window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false))
 async function withAccount<T>(id:string,fn:()=>Promise<T>):Promise<T>{if(accountBusy.has(id))throw new Error('这个账号正在处理另一项操作，请稍后再试。');accountBusy.add(id);try{return await fn()}finally{accountBusy.delete(id)}}
 async function dispatch(command:Command):Promise<unknown>{
  if(lifecycle!=='ready'&&command.type!=='app.quit')throw new Error('应用正在保存状态，请稍后操作。')
  switch(command.type){
   case 'account.add':{const a:Account={id:randomUUID(),platform:command.platform,label:command.label,createdAt:Date.now(),loginStatus:'unknown'};store.saveAccount(a);return a}
   case 'account.rename':{const a=account(command.accountId);store.saveAccount({...a,label:command.label});return null}
   case 'account.open':return withAccount(command.accountId,async()=>{await runtime.browse(account(command.accountId));return null})
   case 'account.check':return withAccount(command.accountId,async()=>{const a=account(command.accountId);const probes=await runtime.adapter(a.platform).read(runtime.contentsFor(a.id));a.loginStatus=probes.some(p=>p.login==='attention')?'attention':probes.some(p=>p.login==='logged-out')?'logged-out':probes.some(p=>p.login==='logged-in')?'logged-in':'unknown';store.saveAccount(a);return a.loginStatus})
   case 'account.logout':case 'account.delete':return withAccount(command.accountId,async()=>{const a=account(command.accountId);await engine.cancelAccount(a.id);await runtime.clearAccount(a);for(const c of store.courses(a.id))chapters.delete(c.id);if(command.type==='account.delete')store.removeAccount(a.id);else store.saveAccount({...a,loginStatus:'logged-out'});return null})
   case 'courses.refresh':return withAccount(command.accountId,async()=>{const a=account(command.accountId);const current=runtime.info().find(v=>v.accountId===a.id);if(!current)await runtime.browse(a,platformOf(a.platform).courses);if(current?.mode==='task')throw new Error('请暂停该平台任务后再刷新课程，避免改变播放页面。');const courses=await runtime.adapter(a.platform).courses(runtime.contentsFor(a.id),a);store.saveCourses(courses);return courses.length})
   case 'course.open':{const c=store.courses().find(c=>c.id===command.courseId);if(!c)throw new Error('找不到课程，请刷新。');return withAccount(c.accountId,async()=>{await runtime.browseCourse(account(c.accountId),c);return null})}
   case 'course.chapters':{const c=store.courses().find(c=>c.id===command.courseId);if(!c)throw new Error('找不到课程。');return withAccount(c.accountId,async()=>{const existing=runtime.info().find(v=>v.accountId===c.accountId);if(existing?.mode==='task')throw new Error('请先暂停该平台任务，再读取章节。');if(!runtime.courseIsOpen(c.accountId,c.id))await runtime.browseCourse(account(c.accountId),c);const list=await runtime.adapter(c.platform).chapters(runtime.contentsFor(c.accountId),c);chapters.set(c.id,list);return list})}
   case 'task.add':{const c=store.courses().find(c=>c.id===command.courseId);if(!c)throw new Error('找不到课程。');if(accountBusy.has(c.accountId))throw new Error('这个账号正在读取或清理数据，请稍后再试。');return engine.add(c,chapters.get(c.id)??[],command.chapterIds)}
   case 'queue.start':{if(store.accounts().some(a=>a.platform===command.platform&&accountBusy.has(a.id)))throw new Error('该平台有账号正在处理，请稍后再启动。');return engine.start(command.platform)}
   case 'queue.pause':return engine.pausePlatform(command.platform)
   case 'task.pause':return engine.pause(command.taskId)
   case 'task.resume':{const t=store.tasks().find(t=>t.id===command.taskId);if(t&&accountBusy.has(t.accountId))throw new Error('该账号正在处理，请稍后恢复。');return engine.resume(command.taskId)}
   case 'task.cancel':return engine.cancel(command.taskId)
   case 'task.reorder':return engine.reorder(command.taskId,command.direction)
   case 'view.show':runtime.show(command.platform,command.bounds);return null
   case 'view.hide':runtime.hide();return null
   case 'view.navigate':return runtime.navigate(command.platform,command.action)
   case 'view.close':{if(store.tasks().some(t=>t.platform===command.platform&&t.status==='running'))throw new Error('请先暂停该平台任务再关闭页面。');runtime.close(command.platform);return null}
   case 'settings.update':{const next=reminders.updateSettings(command.settings);runtime.setAudio(next.muteAll,next.audiblePlatform);return null}
   case 'notices.read':store.readNotices();return null
   case 'data.clear-history':store.clearHistory();return null
   case 'diagnostics.export':{
    runtime.hide();const result=await dialog.showSaveDialog(window,{title:'导出脱敏诊断信息',defaultPath:'campus-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return null
    const s=snapshot();const report={version:s.version,exportedAt:new Date().toISOString(),fixtureMode,compatibility:platforms.map(p=>({platform:p.id,status:p.verification,scope:p.scope})),accountCounts:Object.fromEntries(platformIds.map(p=>[p,s.accounts.filter(a=>a.platform===p).length])),tasks:s.tasks.map(t=>({id:fingerprint(t.id),platform:t.platform,status:t.status,chapterIndex:t.chapterIndex,platformCompletion:t.platformCompletion})),views:s.views.map(v=>({platform:v.platform,mode:v.mode,visible:v.visible})),logs:store.logs()};await writeFile(result.filePath,JSON.stringify(report,null,2),'utf8');return '诊断文件已导出，不包含页面内容、账号名称、课程名称或登录凭据。'
   }
   case 'app.quit':void quit();return null
  }
 }
 ipcMain.handle('campus:snapshot',async(event):Promise<Result<Snapshot>>=>{try{authorize(event);return {ok:true,data:snapshot()}}catch{return {ok:false,error:'无法读取应用状态。'}}})
 ipcMain.handle('campus:command',async(event,value):Promise<Result>=>{
  try{authorize(event);const parsed=commandSchema.safeParse(value);if(!parsed.success)return {ok:false,error:'操作参数无效，请刷新应用后重试。'};const result=await dispatch(parsed.data as Command);if((parsed.data as Command).type!=='view.show')broadcast();return {ok:true,data:result??null}}
  catch(error){return {ok:false,error:redact(error instanceof Error?error.message:'操作失败，请重试。')}}
 })
 const trayImage=nativeImage.createFromPath(join(__dirname,'../../resources/tray.png'))
 const tray=new Tray(trayImage);tray.setToolTip('网课助手 · 本地学习');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开网课助手',click:()=>{window.show();window.focus()}},{label:'暂停全部任务',click:()=>{void Promise.all(platformIds.map(p=>engine.pausePlatform(p)))}},{type:'separator'},{label:'完全退出',click:()=>void quit()}]));tray.on('double-click',()=>{window.show();window.focus()})
 window.on('close',event=>{if(!readyToQuit){event.preventDefault();if(store.settings().closeToTray){window.hide();runtime.windowHidden()}else void quit()}})
 window.on('minimize',()=>runtime.windowHidden());window.on('restore',()=>runtime.windowShown());window.on('show',()=>runtime.windowShown())
 app.on('second-instance',()=>{window.show();window.focus()})
 const tick=setInterval(()=>{if(lifecycle==='ready'){void engine.tick().catch(()=>warn('任务状态检查失败，已保留本地记录。'));void runtime.guardBrowsing();reminders.tick();broadcast()}},2500)
 const suspend=()=>{lifecycle='suspending';void engine.interrupt('电脑已休眠，请在唤醒后确认恢复。').finally(broadcast)}
 const resume=()=>{lifecycle='ready';reminders.tick();warn('电脑已唤醒，请检查网络并确认恢复学习任务。');broadcast()}
 powerMonitor.on('suspend',suspend);powerMonitor.on('resume',resume)
 async function quit():Promise<void>{
  if(quitting)return;quitting=true;lifecycle='quitting';clearInterval(tick);if(flushTimer)clearTimeout(flushTimer)
  try{await engine.interrupt('应用已退出，请确认恢复并重新核对平台状态。');runtime.closeAll();store.close()}finally{tray.destroy();readyToQuit=true;app.quit()}
 }
 app.on('before-quit',event=>{if(!readyToQuit){event.preventDefault();void quit()}})
 if(fixtureMode)(globalThis as unknown as {__campusTest:unknown}).__campusTest={engine,store,runtime,reminders,suspend,resume,snapshot}
 await window.loadURL(expectedUrl);window.show();reminders.tick();broadcast()
}
