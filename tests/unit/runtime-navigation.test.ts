import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { session, WebContentsView, type BrowserWindow, type Session } from 'electron'
import { BrowserRuntime } from '../../src/main/runtime'
import { PlatformAdapter } from '../../src/main/adapters/adapter'
import type { Account, Course } from '../../src/shared/contracts'

vi.mock('electron',()=>({BrowserWindow:vi.fn(),WebContentsView:vi.fn(),session:{fromPartition:vi.fn()}}))

const signedEntry='https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301&ckenc=synthetic-signature'
const legacyEntry='http://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=101&clazzid=201&cpi=301&ckenc=synthetic-hop'
const otherPage='https://i.chaoxing.com/space/index'
interface PendingLoad {url:string;resolve:()=>void;reject:(error:unknown)=>void;stopped:boolean;failed:boolean}

class FakeContents extends EventEmitter {
 url='';destroyed=false;loads:PendingLoad[]=[];active?:PendingLoad
 setAudioMuted=vi.fn();send=vi.fn();setWindowOpenHandler=vi.fn();reload=vi.fn()
 navigationHistory={canGoBack:()=>true,goBack:vi.fn()}
 getURL(){return this.url}
 isDestroyed(){return this.destroyed}
 loadURL=vi.fn((url:string)=>new Promise<void>((resolve,reject)=>{
  const pending={url,resolve,reject,stopped:false,failed:false};this.loads.push(pending);this.active=pending
  this.emit('did-start-navigation',{url,isMainFrame:true,isSameDocument:false},url,false,true)
 }))
 stop=vi.fn(()=>{if(this.active){this.active.stopped=true;this.active.reject({errno:-3})}})
 close=vi.fn(()=>{this.destroyed=true;this.active?.reject({errno:-3});this.emit('destroyed')})
 finish(index:number){const pending=this.loads[index];if(this.active===pending&&!pending.stopped&&!pending.failed){this.url=pending.url;this.emit('did-navigate',{},this.url)}pending.resolve()}
 fail(index:number,errno=-3){this.loads[index].failed=true;this.loads[index].reject({errno})}
 redirect(url:string,isMainFrame=true){const event={url,isMainFrame,preventDefault:vi.fn()};this.emit('will-redirect',event,url,false,isMainFrame);return event}
 requestNavigation(url:string,isMainFrame=true){const event={url,isMainFrame,preventDefault:vi.fn()};this.emit('will-frame-navigate',event);return event}
}

const accounts:Account[]=[
 {id:'account-a',platform:'chaoxing',label:'合成导航账号 A',createdAt:0,loginStatus:'unknown'},
 {id:'account-b',platform:'chaoxing',label:'合成导航账号 B',createdAt:0,loginStatus:'unknown'}
]
let runtime:BrowserRuntime,warn=vi.fn<(message:string)=>void>()
const resultOf=(promise:Promise<void>)=>promise.then(()=>null,error=>error as Error)
const contentsFor=(account=accounts[0])=>runtime.contentsFor(account.id) as unknown as FakeContents
async function flush(){for(let n=0;n<8;n++)await Promise.resolve()}

beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks()
 vi.mocked(session.fromPartition).mockImplementation(()=>Object.assign(new EventEmitter(),{setPermissionCheckHandler:vi.fn(),setPermissionRequestHandler:vi.fn(),webRequest:{onBeforeRequest:vi.fn()}}) as unknown as Session)
 vi.mocked(WebContentsView).mockImplementation(function(){return {webContents:new FakeContents(),setVisible:vi.fn(),setBounds:vi.fn()} as unknown as WebContentsView})
 const window={contentView:{addChildView:vi.fn(),removeChildView:vi.fn()}} as unknown as BrowserWindow
 warn=vi.fn<(message:string)=>void>();runtime=new BrowserRuntime(window,id=>accounts.find(a=>a.id===id)!,vi.fn(),warn)
})
afterEach(()=>{runtime.closeAll();vi.restoreAllMocks();vi.useRealTimers()})

describe('navigation ownership and bounded HTTPS recovery',()=>{
 it('stops its timed-out request so a late completion cannot replace the page',async()=>{
  const result=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  await vi.advanceTimersByTimeAsync(30000)
  expect((await result)?.message).toContain('超时');expect(contents.stop).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  contents.finish(0)
  expect(contents.getURL()).toBe('');expect(contents.loadURL).toHaveBeenCalledTimes(1)
  contents.redirect(legacyEntry)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('主页面 · 服务端重定向'))
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/synthetic-signature|synthetic-hop|ckenc/)
 })

 it('cancels an earlier request without letting its timeout stop a newer request in the same view',async()=>{
  const first=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  let firstError:Error|null|undefined;void first.then(error=>{firstError=error})
  await vi.advanceTimersByTimeAsync(5000)
  const next=resultOf(runtime.browse(accounts[0],otherPage));await flush()
  expect(firstError?.message).toContain('取消')
  await vi.advanceTimersByTimeAsync(25000)
  expect(contents.stop).not.toHaveBeenCalled()
  contents.finish(1);expect(await next).toBeNull();expect(contents.getURL()).toBe(otherPage)
  expect(vi.getTimerCount()).toBe(0)
  contents.finish(0);expect(contents.getURL()).toBe(otherPage)
 })

 it.each(['close','replace-account'] as const)('reports cancellation when %s interrupts the HTTPS retry',async action=>{
  const result=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  expect(contents.redirect(legacyEntry).preventDefault).toHaveBeenCalledTimes(1)
  contents.fail(0);await flush();expect(contents.loadURL).toHaveBeenCalledTimes(2)
  let replacement:Promise<Error|null>|undefined
  if(action==='close')runtime.close('chaoxing')
  else replacement=resultOf(runtime.browse(accounts[1],otherPage))
  await flush();expect((await result)?.message).toContain('取消')
  if(replacement){const next=contentsFor(accounts[1]);next.finish(0);expect(await replacement).toBeNull();expect(next.stop).not.toHaveBeenCalled()}
  expect(warn).not.toHaveBeenCalled()
 })

 it('keeps a new same-account request independent of a cancelled HTTPS retry',async()=>{
  const first=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  contents.redirect(legacyEntry);contents.fail(0);await flush()
  const next=resultOf(runtime.browse(accounts[0],otherPage));await flush()
  contents.fail(1);await flush();expect((await first)?.message).toContain('取消')
  expect(contents.stop).not.toHaveBeenCalled();expect(contents.loadURL).toHaveBeenCalledTimes(3)
  contents.finish(2);expect(await next).toBeNull();expect(contents.getURL()).toBe(otherPage)
 })

 it('releases signed retry eligibility when the page initiates an unrelated main-frame navigation',async()=>{
  const result=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  let error:Error|null|undefined;void result.then(value=>{error=value})
  contents.requestNavigation(otherPage)
  contents.redirect(legacyEntry);contents.fail(0);await flush()
  expect(error?.message).toContain('取消');expect(contents.loadURL).toHaveBeenCalledTimes(1)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('主页面 · 服务端重定向'))
 })

 it.each(['reload','back'] as const)('cancels the old attempt before the workbench requests %s',async action=>{
  const result=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  let error:Error|null|undefined;void result.then(value=>{error=value})
  await runtime.navigate('chaoxing',action);await flush()
  expect(error?.message).toContain('取消');expect(contents.stop).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  contents.redirect(legacyEntry);expect(contents.loadURL).toHaveBeenCalledTimes(1)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('主页面 · 服务端重定向'))
 })

 it('does not let a child-frame redirect cancel or retry the main-frame request',async()=>{
  const result=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  const event=contents.redirect(legacyEntry,false);expect(event.preventDefault).toHaveBeenCalledTimes(1)
  contents.finish(0);expect(await result).toBeNull();expect(contents.loadURL).toHaveBeenCalledTimes(1)
  expect(contents.stop).not.toHaveBeenCalled();expect(warn).toHaveBeenCalledWith(expect.stringContaining('嵌套页面 · 服务端重定向'))
 })

 it('still allows only one HTTPS retry and returns the actual repeated HTTP blocker',async()=>{
  const result=resultOf(runtime.browse(accounts[0],signedEntry)),contents=contentsFor()
  contents.redirect(legacyEntry);contents.fail(0);await flush()
  expect(contents.loadURL).toHaveBeenNthCalledWith(2,legacyEntry.replace('http:','https:'))
  contents.redirect(legacyEntry);contents.fail(1);await flush()
  expect((await result)?.message).toContain('主页面 · 服务端重定向')
  expect(contents.loadURL).toHaveBeenCalledTimes(2);expect(contents.stop).not.toHaveBeenCalled()
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/synthetic-signature|synthetic-hop|ckenc/)
 })
})

describe('course entry document ownership',()=>{
 const course:Course={id:'synthetic-course',accountId:accounts[0].id,platform:'chaoxing',title:'合成课程入口',url:signedEntry.replace('&ckenc=synthetic-signature',''),updatedAt:0,completion:'unknown'}
 it.each([true,false])('rejects an entry read before a reload in the %s main-frame flag',async isMainFrame=>{
  const starting=runtime.browse(accounts[0],otherPage),contents=contentsFor();contents.finish(0);await starting
  let completeEntry!:(value:string)=>void
  vi.spyOn(PlatformAdapter.prototype,'resolveCourseUrl').mockReturnValueOnce(new Promise(resolve=>{completeEntry=resolve}))
  const result=resultOf(runtime.browseCourse(accounts[0],course))
  contents.emit('did-start-navigation',{url:otherPage,isMainFrame,isSameDocument:false},otherPage,false,isMainFrame)
  completeEntry(signedEntry);await flush()
  if(contents.loads.length>1)contents.finish(1)
  expect((await result)?.message).toContain('改变')
  expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(runtime.courseIsOpen(accounts[0].id,course.id)).toBe(false)
 })

 it('accepts a current directory entry and records only its own completed course',async()=>{
  const starting=runtime.browse(accounts[0],otherPage),contents=contentsFor();contents.finish(0);await starting
  vi.spyOn(PlatformAdapter.prototype,'resolveCourseUrl').mockResolvedValueOnce(signedEntry)
  const result=resultOf(runtime.browseCourse(accounts[0],course));await flush();contents.finish(1)
  expect(await result).toBeNull();expect(runtime.courseIsOpen(accounts[0].id,course.id)).toBe(true)
 })

 it('releases the old course binding after the main page changes its route without reloading',async()=>{
  const starting=runtime.browse(accounts[0],otherPage),contents=contentsFor();contents.finish(0);await starting
  vi.spyOn(PlatformAdapter.prototype,'resolveCourseUrl').mockResolvedValueOnce(signedEntry)
  const opening=resultOf(runtime.browseCourse(accounts[0],course));await flush();contents.finish(1);expect(await opening).toBeNull()
  const anotherCourse=signedEntry.replace('courseId=101','courseId=102')
  contents.url=anotherCourse;contents.emit('did-navigate-in-page',{},anotherCourse,true)
  expect(runtime.courseIsOpen(accounts[0].id,course.id)).toBe(false)
 })
})
