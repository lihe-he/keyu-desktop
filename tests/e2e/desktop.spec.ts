import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Command, Snapshot } from '../../src/shared/contracts'
import { platformOf } from '../../src/shared/platforms'
// Defer database-backed main-process inspection to the event loop. Inspector evaluation
// can otherwise interrupt a synchronous SQLite query and attempt to re-enter it.
let app:ElectronApplication,page:Page,data:string
const env=()=>{const e:NodeJS.ProcessEnv={...process.env,CAMPUS_TEST_MODE:'1',CAMPUS_USER_DATA:data};delete e.ELECTRON_RUN_AS_NODE;return Object.fromEntries(Object.entries(e).filter((pair):pair is [string,string]=>pair[1]!==undefined))}
async function launch(){app=await electron.launch({args:['.'],env:env()});page=await app.firstWindow();await page.waitForFunction(()=>!!window.campus);return page}
async function command(c:Command):Promise<any>{const r=await page.evaluate(c=>window.campus.command(c),c);if(!r.ok)throw new Error(r.error);return r.data}
async function snapshot():Promise<Snapshot>{return page.evaluate(async()=>{const r=await window.campus.snapshot();if(!r.ok)throw Error(r.error);return r.data})}
test.beforeEach(async()=>{await mkdir('.test-data',{recursive:true});data=await mkdtemp(join(process.cwd(),'.test-data','e2e-'));await launch()})
test.afterEach(async()=>{await app?.close()})
test('three platform media flows, isolation, lifecycle and persisted storage',async()=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await mkdir('reports/screenshots',{recursive:true});await page.screenshot({path:'reports/screenshots/01-home.png'});
 expect((await snapshot()).accounts).toHaveLength(0)
 const ids:string[]=[]
 for(const platform of ['chaoxing','icourse','zhihuishu'] as const){
  const a=await command({type:'account.add',platform,label:'测试同学 · '+platform});ids.push(a.id)
  await command({type:'account.open',accountId:a.id});await command({type:'courses.refresh',accountId:a.id});
  const c=(await snapshot()).courses.find(c=>c.accountId===a.id)!
  if(platform==='chaoxing'){expect(c.url).toContain('https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle');expect(c.url).not.toContain('synthetic-context');expect(c.title).not.toContain('示例教师')}
  const chapters=await command({type:'course.chapters',courseId:c.id});expect(chapters).toHaveLength(2)
  await command({type:'task.add',courseId:c.id,chapterIds:[]})
 }
 await Promise.all((['chaoxing','icourse','zhihuishu'] as const).map(platform=>command({type:'queue.start',platform})))
 let s=await snapshot();expect(s.tasks.filter(t=>t.status==='running')).toHaveLength(3);expect(s.views).toHaveLength(3)
 await expect.poll(async()=>(await snapshot()).tasks.map(t=>({status:t.status,reason:t.reason})),{timeout:40000}).toEqual(expect.arrayContaining([expect.objectContaining({status:'finished'})]))
 await expect.poll(async()=>(await snapshot()).tasks.filter(t=>t.status==='finished').length,{timeout:40000}).toBe(3)
 s=await snapshot();expect(s.tasks.every(t=>t.platformCompletion==='complete')).toBe(true);expect(s.views).toHaveLength(0);expect(s.stats.playbackMs).toBeGreaterThan(s.stats.elapsedMs)
 await command({type:'account.open',accountId:ids[0]})
 const other=await command({type:'account.add',platform:'chaoxing',label:'同平台第二账号'})
 await command({type:'account.open',accountId:other.id})
 const cookies=await app.evaluate(async(_electron,ids)=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;return Promise.all(ids.map(async(id:string)=>{const a=t.store.accounts().find((a:any)=>a.id===id);const ses=t.runtime.getSession(a);return {id,cookies:await ses.cookies.get({name:'fixtureAccount'})}}))},[ids[0],other.id])
 expect(cookies[0].cookies[0].value).toBe(ids[0]);expect(cookies[1].cookies[0].value).toBe(other.id)
 const isolation=await app.evaluate(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;const a=t.store.accounts().at(-1);return t.runtime.contentsFor(a.id).executeJavaScript('({node:typeof require,bridge:typeof window.campus})')});expect(isolation).toEqual({node:'undefined',bridge:'undefined'})
 await command({type:'account.delete',accountId:other.id});expect((await snapshot()).accounts).toHaveLength(3)
 const kept=await app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;return t.runtime.getSession(t.store.accounts().find((a:any)=>a.id===id)).cookies.get({name:'fixtureAccount'})},ids[0]);expect(kept[0].value).toBe(ids[0])
 await command({type:'settings.update',settings:{muteAll:true,reminderEnabled:true,reminderTime:'18:30'}})
 await app.close();await launch();s=await snapshot();expect(s.accounts).toHaveLength(3);expect(s.settings.muteAll).toBe(true);expect(s.tasks.filter(t=>t.status==='finished')).toHaveLength(3);expect(s.views).toHaveLength(0);expect(errors).toEqual([])
})

async function prepare(platform:'chaoxing'|'icourse'|'zhihuishu'='chaoxing'){
 const a=await command({type:'account.add',platform,label:'恢复测试 '+platform});await command({type:'account.open',accountId:a.id});await command({type:'courses.refresh',accountId:a.id});const c=(await snapshot()).courses.find(c=>c.accountId===a.id)!;await command({type:'course.chapters',courseId:c.id});const t=await command({type:'task.add',courseId:c.id,chapterIds:[]});return {a,c,t}
}
test('all six pages operate through the UI, with safe modals and native view lifecycle',async()=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const nav=page.getByRole('navigation',{name:'主导航'});
 await nav.getByRole('button',{name:'账号管理',exact:true}).click();await page.getByTestId('add-account').click();await page.getByTestId('account-label').fill('我的测试账号');await page.getByRole('button',{name:'添加并打开登录'}).click();await expect(page.locator('h1')).toHaveText('学习工作台');await expect.poll(async()=>(await snapshot()).views.length).toBe(1)
 await expect(page.getByRole('button',{name:'打开学习通个人空间',exact:true})).toBeVisible();await expect(page.locator('.workbench-status')).toContainText('课表不是网课目录')
 await nav.getByRole('button',{name:'账号管理',exact:true}).click();await expect(page.getByRole('heading',{name:'我的测试账号',exact:true})).toBeVisible();await page.screenshot({path:'reports/screenshots/02-accounts.png'});
 await page.getByRole('button',{name:'修改账号备注'}).click();await page.getByRole('textbox').fill('我的课程账号');await page.getByRole('button',{name:'保存备注'}).click();await expect(page.getByRole('heading',{name:'我的课程账号',exact:true})).toBeVisible()
 await nav.getByRole('button',{name:'我的课程',exact:true}).click();await page.getByRole('button',{name:'刷新所选账号'}).click();await expect(page.getByRole('button',{name:'选择章节'})).toBeVisible();await page.screenshot({path:'reports/screenshots/03-courses.png'});
 await page.getByRole('button',{name:'选择章节'}).click();await expect(page.getByRole('button',{name:'加入学习队列'})).toBeVisible();await expect.poll(async()=>(await snapshot()).views.some(v=>v.visible)).toBe(false);await page.screenshot({path:'reports/screenshots/04-chapters.png'});await page.getByRole('button',{name:'加入学习队列'}).click()
 await nav.getByRole('button',{name:'任务中心',exact:true}).click();await page.getByRole('button',{name:'启动队列'}).first().click();await expect(page.getByRole('button',{name:'暂停任务'})).toBeVisible();await page.getByRole('button',{name:'暂停任务'}).click();await expect(page.getByRole('button',{name:'确认恢复'})).toBeVisible();await page.screenshot({path:'reports/screenshots/05-tasks.png'});
 await page.getByRole('button',{name:'确认恢复'}).click();await page.getByRole('button',{name:'查看平台页面'}).click();await expect(page.locator('h1')).toHaveText('学习工作台');await expect.poll(async()=>(await snapshot()).views.some(v=>v.visible)).toBe(true);await expect(page.locator('.address-pill')).toContainText('任务页面');
 await expect(page.getByRole('complementary',{name:'当前任务章节列表'})).toBeVisible();await expect(page.locator('#workbench-chapters li')).toHaveCount(2);await expect(page.locator('#workbench-chapters li[aria-current="step"]')).toContainText('视频 1');
 const beforeBounds=await page.getByTestId('browser-host').boundingBox();await page.getByRole('button',{name:'收起章节',exact:true}).click();await expect(page.getByRole('complementary',{name:'当前任务章节列表'})).toHaveCount(0);await expect.poll(async()=>(await page.getByTestId('browser-host').boundingBox())!.width).toBeGreaterThan(beforeBounds!.width);await page.getByRole('button',{name:'展开章节',exact:true}).click();await expect(page.locator('#workbench-chapters li')).toHaveCount(2);
await page.screenshot({path:'reports/screenshots/06-workbench.png'});const native=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await writeFile('reports/screenshots/06-workbench-native.png',Buffer.from(native,'base64'));
 await expect.poll(async()=>(await snapshot()).tasks[0].playbackState).toBe('playing');
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus()});await page.waitForTimeout(400)
 const desktop=await app.evaluate(async({BrowserWindow,desktopCapturer})=>{const w=BrowserWindow.getAllWindows()[0];const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1600,height:1200}});const source=sources.find(s=>s.id===w.getMediaSourceId());if(!source||source.thumbnail.isEmpty())throw Error('Own application window capture unavailable');return source.thumbnail.toPNG().toString('base64')});await writeFile('reports/screenshots/06-workbench-window.png',Buffer.from(desktop,'base64'));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,720));await expect.poll(async()=>page.evaluate(()=>window.innerWidth)).toBeLessThan(1100);await expect.poll(async()=>{
  const host=await page.getByTestId('browser-host').boundingBox(),outline=await page.locator('#workbench-chapters').boundingBox();return !!host&&!!outline&&host.width>400&&host.x+host.width<=outline.x+2;
 }).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect.poll(async()=>app.evaluate(async({BrowserWindow})=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;const w=BrowserWindow.getAllWindows()[0];const active=t.store.tasks().find((t:any)=>t.status==='running');const wc=t.runtime.contentsFor(active.accountId);const child=w.contentView.children.find((v:any)=>v.webContents===wc);const b=child?.getBounds();return !!b&&b.width>400&&b.x+b.width<850})).toBe(true);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1340,880));


 const id=(await snapshot()).tasks[0].id;await page.getByRole('button',{name:'在工作台暂停任务',exact:true}).click();await expect(page.getByRole('heading',{name:'任务已保留，页面已释放'})).toBeVisible();await expect(page.locator('#workbench-chapters li')).toHaveCount(2);expect((await snapshot()).views).toHaveLength(0);await page.getByRole('button',{name:'在工作台确认恢复',exact:true}).click();await expect(page.locator('.address-pill')).toContainText('任务页面');await expect.poll(async()=>(await snapshot()).tasks.find(t=>t.id===id)?.playbackState).toBe('playing');await expect(page.getByTestId('player-observation')).toContainText('播放器正在播放');await command({type:'task.pause',taskId:id});await nav.getByRole('button',{name:'记录与设置',exact:true}).click();await page.screenshot({path:'reports/screenshots/07-settings.png'});
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.getTitle()==='网课助手')?.setSize(1080,720)});await page.screenshot({path:'reports/screenshots/08-small-window.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([])
})
test('login expiry pauses only one lane; sleep and abrupt exit require confirmation',async()=>{
 const first=await prepare(),second=await prepare('icourse');await command({type:'queue.start',platform:'chaoxing'});await command({type:'queue.start',platform:'icourse'});
 await app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;const wc=t.runtime.contentsFor(id);const inject=()=>wc.executeJavaScript('(()=>{const el=document.createElement("input");el.type="password";document.body.prepend(el)})()');(wc as any).__testInject=inject;wc.on('dom-ready',inject);await inject()},first.a.id)
 await expect.poll(async()=>(await snapshot()).tasks.find(t=>t.id===first.t.id)?.status).toBe('attention');expect((await snapshot()).tasks.find(t=>t.id===second.t.id)?.status).toBe('running')
 await command({type:'task.resume',taskId:first.t.id});expect((await snapshot()).tasks.find(t=>t.id===first.t.id)?.status).toBe('attention')
 // Human resolves the login challenge; restoring never seeks to an old saved time.
 await app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;const wc=t.runtime.contentsFor(id);wc.removeListener('dom-ready',(wc as any).__testInject);await wc.executeJavaScript('document.querySelector("input")?.remove()')},first.a.id);await command({type:'task.resume',taskId:first.t.id});
 await app.evaluate(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;t.suspend()});await expect.poll(async()=>(await snapshot()).tasks.filter(t=>t.status==='recoverable').length).toBe(2);expect((await snapshot()).views).toHaveLength(0)
 await app.evaluate(async()=>{(globalThis as any).__campusTest.resume()});expect((await snapshot()).tasks.filter(t=>t.status==='running')).toHaveLength(0)
 await command({type:'task.resume',taskId:first.t.id});await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await launch();const s=await snapshot();expect(s.tasks.find(t=>t.id===first.t.id)?.status).toBe('recoverable');expect(s.views).toHaveLength(0)
})
test('rejects forbidden commands and navigation; clearing an account cascades its rows only',async()=>{
 const {a,t}=await prepare();await command({type:'queue.start',platform:'chaoxing'});await command({type:'task.pause',taskId:t.id});await command({type:'account.open',accountId:a.id});
 // Synthetic navigation regression only: never confirms a real QR login.
 const loginReturn=await app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));const wc=(globalThis as any).__campusTest.runtime.contentsFor(id);return new URL(wc.getURL()).searchParams.get('refer')},a.id)
 expect(loginReturn).toBe(platformOf('chaoxing').courses)
 await app.evaluate(async(_e,{id,target})=>{await new Promise<void>(resolve=>setImmediate(resolve));const wc=(globalThis as any).__campusTest.runtime.contentsFor(id);await wc.executeJavaScript('location.href='+JSON.stringify(target))},{id:a.id,target:loginReturn})
 await expect.poll(async()=>app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));return (globalThis as any).__campusTest.runtime.contentsFor(id).getURL()},a.id)).toBe(loginReturn)
 expect((await snapshot()).notices.some(n=>n.body.includes('阻止'))).toBe(false)
 await app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));await (globalThis as any).__campusTest.runtime.contentsFor(id).executeJavaScript('location.href="http://i.mooc.chaoxing.com/space/index"')},a.id)
 await expect.poll(async()=>(await snapshot()).notices.some(n=>n.body.includes('阻止'))).toBe(true)
 await command({type:'data.clear-history'})
 const invalid=await page.evaluate(()=>window.campus.command({type:'execute',script:'require("fs")'} as any));expect(invalid.ok).toBe(false)
 const bad=await page.evaluate(()=>window.campus.command({type:'account.add',platform:'chaoxing',label:'x',extra:'y'} as any));expect(bad.ok).toBe(false)
 await app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));const t=(globalThis as any).__campusTest;await t.runtime.contentsFor(id).executeJavaScript('location.href="https://example.com/forbidden"')},a.id)
 await expect.poll(async()=>(await snapshot()).notices.some(n=>n.body.includes('阻止'))).toBe(true)
 // Read the runtime's redacted view metadata without entering SQLite from the inspector callback.
 const url=await app.evaluate((_e,id)=>(globalThis as any).__campusTest.runtime.info().find((v:any)=>v.accountId===id)?.url,a.id);expect(url).toContain('chaoxing.com');expect(url).not.toContain('example.com')
 const keep=await prepare('icourse');await command({type:'account.delete',accountId:a.id});let s=await snapshot();expect(s.tasks.some(task=>task.accountId===a.id)).toBe(false);expect(s.courses.some(c=>c.accountId===a.id)).toBe(false);expect(s.accounts.some(acc=>acc.id===keep.a.id)).toBe(true)
 await command({type:'task.cancel',taskId:keep.t.id});await command({type:'data.clear-history'});s=await snapshot();expect(s.tasks).toHaveLength(0);expect(s.accounts).toHaveLength(1);expect(s.notices).toHaveLength(0)
})

test('deleting a queued account preserves another account automatic queue progression',async()=>{
 const first=await prepare(),queued=await prepare(),next=await prepare(),last=await prepare();
 await command({type:'queue.start',platform:'chaoxing'});
 await command({type:'account.delete',accountId:queued.a.id});
 let s=await snapshot();expect(s.accounts.some(a=>a.id===queued.a.id)).toBe(false);expect(s.tasks.some(t=>t.id===queued.t.id)).toBe(false);expect(s.views[0].accountId).toBe(first.a.id);
 await expect.poll(async()=>(await snapshot()).tasks.find(t=>t.id===next.t.id)?.status,{timeout:35000}).toBe('running');
 s=await snapshot();expect(s.tasks.find(t=>t.id===first.t.id)?.status).toBe('finished');expect(s.views).toHaveLength(1);expect(s.views[0].accountId).toBe(next.a.id);
 const cookies=await app.evaluate(async(_e,id)=>{await new Promise<void>(resolve=>setImmediate(resolve));return (globalThis as any).__campusTest.runtime.contentsFor(id).session.cookies.get({name:'fixtureAccount'})},next.a.id);expect(cookies.some((c:any)=>c.value===next.a.id)).toBe(true);
 await command({type:'account.delete',accountId:next.a.id});s=await snapshot();expect(s.views).toHaveLength(1);expect(s.views[0].accountId).toBe(last.a.id);expect(s.tasks.find(t=>t.id===last.t.id)?.status).toBe('running');expect(s.accounts.some(a=>a.id===first.a.id)).toBe(true);await command({type:'account.delete',accountId:last.a.id});expect((await snapshot()).views).toHaveLength(0);
 await expect.poll(async()=>app.evaluate(({webContents})=>webContents.getAllWebContents().length)).toBe(1)
})
