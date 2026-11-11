import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { session, WebContentsView, type BrowserWindow, type Session } from 'electron'
import { BrowserRuntime } from '../../src/main/runtime'
import { PlatformAdapter } from '../../src/main/adapters/adapter'
import type { PageProbe } from '../../src/main/adapters/types'
import type { Account, Chapter, Observation, Task } from '../../src/shared/contracts'

vi.mock('electron',()=>({BrowserWindow:vi.fn(),WebContentsView:vi.fn(),session:{fromPartition:vi.fn()}}))

const frameUrl='https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentcourse?courseid=101'
const chapterUrl='https://mooc1-2.chaoxing.com/mooc-ans/knowledge/cards?courseid=101&knowledgeid=301'
const account:Account={id:'synthetic-account',platform:'chaoxing',label:'合成章节账号',createdAt:0,loginStatus:'unknown'}
const chapter:Chapter={id:'synthetic-chapter',courseId:'synthetic-course',title:'合成视频章节',url:chapterUrl,kind:'video',locked:false,completion:'unknown',target:{selector:'.chapter_item',text:'合成视频章节',index:0,frameUrl}}
const task:Task={id:'synthetic-task',platform:'chaoxing',accountId:account.id,courseId:chapter.courseId,title:'合成任务',chapterIds:[chapter.id],chapters:[chapter],chapterIndex:0,status:'running',reason:null,createdAt:0,updatedAt:0,position:0,currentTime:0,duration:0,playbackEnded:false,platformCompletion:'unknown',generation:1}
type ProbeChapter=PageProbe['chapters'][number]
const freshChapter=(patch:Partial<ProbeChapter>={}):ProbeChapter=>({title:chapter.title,url:chapter.url,kind:'video',locked:false,completion:'unknown',target:{...chapter.target!},...patch})
const probe=(chapters:ProbeChapter[],url=frameUrl):PageProbe=>({url,title:'合成章节目录',login:'unknown',issue:null,courses:[],chapters,activeChapter:null,completion:'unknown',media:null})

class FakeContents extends EventEmitter {
 url='';destroyed=false;mainFrame={framesInSubtree:[] as {url:string}[]}
 setAudioMuted=vi.fn();send=vi.fn();setWindowOpenHandler=vi.fn();stop=vi.fn()
 getURL(){return this.url}
 isDestroyed(){return this.destroyed}
 close(){this.destroyed=true;this.emit('destroyed')}
 loadURL=vi.fn(async(url:string)=>{this.url=url;this.mainFrame.framesInSubtree=[{url}];this.emit('did-start-navigation',{url,isMainFrame:true,isSameDocument:false},url,false,true);this.emit('did-navigate',{},url)})
}

let runtime:BrowserRuntime
let read:MockInstance<PlatformAdapter['read']>
let operate:MockInstance<PlatformAdapter['operate']>
let observation:MockInstance<PlatformAdapter['observation']>
const resultOf=(promise:Promise<void>)=>promise.then(()=>null,error=>error as Error)
const contentsFor=()=>runtime.contentsFor(account.id) as unknown as FakeContents
async function flush(){for(let n=0;n<10;n++)await Promise.resolve()}

beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks()
 vi.mocked(session.fromPartition).mockImplementation(()=>Object.assign(new EventEmitter(),{setPermissionCheckHandler:vi.fn(),setPermissionRequestHandler:vi.fn(),webRequest:{onBeforeRequest:vi.fn()}}) as unknown as Session)
 vi.mocked(WebContentsView).mockImplementation(function(){return {webContents:new FakeContents(),setVisible:vi.fn(),setBounds:vi.fn()} as unknown as WebContentsView})
 const window={contentView:{addChildView:vi.fn(),removeChildView:vi.fn()}} as unknown as BrowserWindow
 runtime=new BrowserRuntime(window,()=>account,vi.fn(),vi.fn<(message:string)=>void>())
 read=vi.spyOn(PlatformAdapter.prototype,'read').mockResolvedValue([probe([freshChapter()])])
 operate=vi.spyOn(PlatformAdapter.prototype,'operate').mockResolvedValue(undefined)
 observation=vi.spyOn(PlatformAdapter.prototype,'observation').mockResolvedValue({taskId:task.id,accountId:account.id,chapterId:chapter.id,generation:task.generation,observedAt:0,state:'paused',currentTime:0,duration:1,completion:'unknown',issue:null,url:chapterUrl} satisfies Observation)
})
afterEach(()=>{runtime.closeAll();vi.restoreAllMocks();vi.useRealTimers()})

describe('current chapter target validation',()=>{
 it('does not substitute an identically labelled control in a different frame',async()=>{
  const otherFrame=frameUrl+'&tab=other'
  read.mockResolvedValue([probe([]),probe([freshChapter({target:{...chapter.target!,frameUrl:otherFrame}})],otherFrame)])
  const result=resultOf(runtime.open(task,chapter)),contents=contentsFor()
  expect((await result)?.message).toContain('章节目录发生变化')
  expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(contents.loadURL).toHaveBeenCalledWith(frameUrl)
  expect(operate).not.toHaveBeenCalled();expect(observation).not.toHaveBeenCalled()
 })

 it('stops when the same control now points to another URL',async()=>{
  read.mockResolvedValue([probe([freshChapter({url:chapterUrl.replace('knowledgeid=301','knowledgeid=302')})])])
  const result=resultOf(runtime.open(task,chapter)),contents=contentsFor()
  expect((await result)?.message).toContain('章节目录发生变化')
  expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(operate).not.toHaveBeenCalled();expect(observation).not.toHaveBeenCalled()
 })

 it('rejects multiple current matches instead of trusting the first frame',async()=>{
  read.mockResolvedValue([probe([freshChapter()]),probe([freshChapter()])])
  const result=resultOf(runtime.open(task,chapter)),contents=contentsFor()
  expect((await result)?.message).toContain('章节目录发生变化')
  expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(operate).not.toHaveBeenCalled();expect(observation).not.toHaveBeenCalled()
 })

 it.each([
  [{kind:'manual' as const},'人工'],
  [{locked:true},'尚未解锁']
 ])('stops when the current chapter changes its access or type %#',async(patch,message)=>{
  read.mockResolvedValue([probe([freshChapter(patch)])])
  const result=resultOf(runtime.open(task,chapter)),contents=contentsFor()
  expect((await result)?.message).toContain(message)
  expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(operate).not.toHaveBeenCalled();expect(observation).not.toHaveBeenCalled()
 })

 it.each(['登录已失效，请先在平台登录。','页面要求验证码，请在原页人工处理。'])('preserves a current platform challenge before opening the chapter: %s',async issue=>{
  read.mockResolvedValue([{...probe([freshChapter()]),issue}])
  const result=resultOf(runtime.open(task,chapter)),contents=contentsFor()
  expect((await result)?.message).toBe(issue)
  expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(operate).not.toHaveBeenCalled();expect(observation).not.toHaveBeenCalled()
 })

 it('does not use a chapter read that arrives after its task page was closed',async()=>{
  let completeRead!:(value:PageProbe[])=>void
  read.mockReturnValue(new Promise<PageProbe[]>(resolve=>{completeRead=resolve}))
  const result=resultOf(runtime.open(task,chapter)),contents=contentsFor()
  await flush();expect(read).toHaveBeenCalledTimes(1)
  runtime.close(task.platform,task.id);completeRead([probe([freshChapter()])])
  expect(await result).toBeNull()
  expect(contents.loadURL).toHaveBeenCalledTimes(1);expect(operate).not.toHaveBeenCalled();expect(observation).not.toHaveBeenCalled()
 })

 it('opens the stored direct URL after one exact current target match',async()=>{
  const result=resultOf(runtime.open(task,chapter)),contents=contentsFor()
  expect(await result).toBeNull();expect(contents.loadURL).toHaveBeenCalledTimes(2)
  expect(contents.loadURL).toHaveBeenNthCalledWith(2,chapterUrl)
  expect(operate).not.toHaveBeenCalled();expect(observation).toHaveBeenCalledTimes(1)
 })

 it('keeps the existing in-page control flow after one exact current target match',async()=>{
  const inPage:Chapter={...chapter,url:frameUrl},inPageTask={...task,chapters:[inPage]}
  read.mockResolvedValue([probe([freshChapter({url:frameUrl})])])
  const result=resultOf(runtime.open(inPageTask,inPage)),contents=contentsFor()
  await flush();await vi.advanceTimersByTimeAsync(1200)
  expect(await result).toBeNull();expect(contents.loadURL).toHaveBeenCalledTimes(1)
  expect(operate).toHaveBeenCalledWith(contents,'click',inPage);expect(observation).toHaveBeenCalledTimes(1)
 })
})
