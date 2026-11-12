import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import type { Chapter, Task } from '../../src/shared/contracts'
import { PlatformAdapter } from '../../src/main/adapters/adapter'
import type { PageProbe } from '../../src/main/adapters/types'
import { makeAccount, makeCourse } from './helpers'

const identity='https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301'
const page=(urls=[identity+'&ckenc=synthetic-first']):PageProbe=>({url:'https://v24.chaoxing.com/wfw/courselist/course3?space_token=synthetic-context',title:'脱敏课程目录',login:'unknown',issue:null,chapters:[],activeChapter:null,completion:'unknown',media:null,courses:urls.map(url=>({title:'脱敏课程甲',url,completion:'unknown',locked:false,kind:'unknown'}))})
const contents={} as WebContents
describe('signed course entry resolution',()=>{
 it('never returns signed entry or directory credentials in persisted courses',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([page()])
  const courses=await a.courses(contents,makeAccount())
  expect(courses).toHaveLength(1);expect(courses[0].url).toBe(identity)
  expect(JSON.stringify(courses)).not.toMatch(/ckenc|space_token|synthetic-/)
  const id=courses[0].id;vi.mocked(a.read).mockResolvedValue([page([identity+'&ckenc=synthetic-second'])])
  expect((await a.courses(contents,makeAccount()))[0].id).toBe(id)
  expect(await a.resolveCourseUrl(contents,courses[0])).toBe(identity+'&ckenc=synthetic-second')
 })
 it('requires the current directory, matching course identifiers and no login challenge',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([page()]);const [course]=await a.courses(contents,makeAccount())
  vi.mocked(a.read).mockResolvedValue([page([])]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('当前账号')
  vi.mocked(a.read).mockResolvedValue([page([identity.replace('clazzId=201','clazzId=202')+'&ckenc=synthetic'])]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('当前账号')
  vi.mocked(a.read).mockResolvedValue([{...page(),issue:'登录已失效'}]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('登录已失效')
 })
 it('refuses multiple competing entries instead of guessing a signature',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([page()]);const [course]=await a.courses(contents,makeAccount())
  vi.mocked(a.read).mockResolvedValue([page([identity+'&ckenc=synthetic-a',identity+'&ckenc=synthetic-b'])]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('当前账号')
 })
})

describe('chapter identity and observation',()=>{
 const course=makeCourse()
 const chapter=(index:number):Chapter=>({id:'chapter-'+index,courseId:course.id,title:'视频 导论',url:course.url,kind:'video',locked:false,completion:'unknown',target:{selector:'.chapter_item',text:'视频 导论',index,frameUrl:course.url}})
 const task=(chapters=[chapter(0),chapter(1)]):Task=>({id:'task',platform:course.platform,accountId:course.accountId,courseId:course.id,title:course.title,chapterIds:chapters.map(c=>c.id),chapters,chapterIndex:0,status:'running',reason:null,createdAt:1,updatedAt:1,position:1,currentTime:0,duration:0,playbackEnded:false,platformCompletion:'unknown',generation:1})
 const observedContents={getURL:()=>course.url} as WebContents
 const probe=(activeIndex=0):PageProbe=>({...page(),url:course.url,courses:[],chapters:[],activeChapter:'视频 导论',activeTarget:chapter(activeIndex).target,completion:'complete',media:{state:'playing',currentTime:3,duration:10,error:false}})
 it('keeps same-title in-page chapter targets distinct and stable across reads',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([{...probe(),chapters:[chapter(0),chapter(1)]}])
  const first=await a.chapters(contents,course),second=await a.chapters(contents,course)
  expect(first).toHaveLength(2);expect(new Set(first.map(c=>c.id)).size).toBe(2)
  expect(first.map(c=>c.id)).toEqual(second.map(c=>c.id));expect(first.map(c=>c.target?.index)).toEqual([0,1])
 })
 it('continues to reject signed target frame URLs even when chapter links are stable',async()=>{
  const a=new PlatformAdapter('chaoxing'),c=chapter(0);c.target!.frameUrl=course.url+'?token=synthetic-context'
  vi.spyOn(a,'read').mockResolvedValue([{...probe(),chapters:[c]}])
  await expect(a.chapters(contents,course)).rejects.toThrow('未可靠识别章节')
 })
 it('rejects the wrong active target even when its caption matches',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([probe(1)])
  const result=await a.observation(observedContents,task())
  expect(result.issue).toContain('章节发生变化');expect(result.completion).toBe('unknown')
 })
 it('accepts the selected active target among same-title chapters',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([probe(0)])
  const result=await a.observation(observedContents,task())
  expect(result.issue).toBeNull();expect(result.completion).toBe('complete')
 })
 it('accepts a direct chapter target on the currently loaded final page',async()=>{
  const a=new PlatformAdapter('chaoxing'),c=chapter(0);c.url=course.url+'?chapter=0'
  const finalUrl=course.url+'?chapter=0&view=player',p=probe();p.url=finalUrl;p.activeTarget={...c.target!,frameUrl:finalUrl}
  vi.spyOn(a,'read').mockResolvedValue([p])
  expect((await a.observation({getURL:()=>finalUrl} as WebContents,task([c]))).issue).toBeNull()
 })
 it('requires target evidence when legacy probes cannot distinguish same-title chapters',async()=>{
  const a=new PlatformAdapter('chaoxing'),legacy=probe();delete legacy.activeTarget;vi.spyOn(a,'read').mockResolvedValue([legacy])
  expect((await a.observation(observedContents,task())).issue).toContain('章节发生变化')
 })
 it('retains unique-title legacy probe compatibility',async()=>{
  const a=new PlatformAdapter('chaoxing'),legacy=probe();delete legacy.activeTarget;vi.spyOn(a,'read').mockResolvedValue([legacy])
  expect((await a.observation(observedContents,task([chapter(0)]))).issue).toBeNull()
 })
 it('does not select completion from competing active frames',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([probe(),{...probe(),media:null}])
  const result=await a.observation(observedContents,task())
  expect(result.issue).toContain('多个当前章节');expect(result.completion).toBe('unknown')
 })
 it('preserves an explicit ambiguous-current issue when no active target is chosen',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([{...probe(),activeChapter:null,activeTarget:null,issue:'页面存在多个当前章节标记，无法可靠确认所选章节。'}])
  const result=await a.observation(observedContents,task())
  expect(result.issue).toContain('多个当前章节');expect(result.completion).toBe('unknown')
 })
 it('validates a legacy probe payload without requiring the new target field',async()=>{
  const a=new PlatformAdapter('chaoxing'),legacy=probe();delete legacy.activeTarget
  const frame={url:course.url,detached:false},wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:frame,executeJavaScriptInIsolatedWorld:vi.fn().mockResolvedValue(legacy)})
  Object.assign(frame,{framesInSubtree:[frame]})
  expect(await a.read(wc as unknown as WebContents)).toEqual([legacy])
 })
})

describe('probe document lifetime',()=>{
 it.each(['same-url-reload','child-navigation','in-page-navigation','frame-detached','render-exit','destroyed'] as const)('rejects old probes after %s and removes temporary listeners',async change=>{
  const a=new PlatformAdapter('chaoxing'),payload=page(),frame={url:payload.url,detached:false}
  Object.assign(frame,{framesInSubtree:[frame]})
  let completeProbe!:(value:PageProbe)=>void
  const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:frame,executeJavaScriptInIsolatedWorld:vi.fn().mockReturnValue(new Promise(resolve=>{completeProbe=resolve}))})
  const reading=a.read(wc as unknown as WebContents)
  if(change==='frame-detached')frame.detached=true
  else if(change==='render-exit')wc.emit('render-process-gone',{}, {reason:'crashed'})
  else if(change==='destroyed')wc.emit('destroyed')
  else if(change==='in-page-navigation')wc.emit('did-navigate-in-page',{},payload.url+'#next',true)
  else wc.emit('did-start-navigation',{url:payload.url,isMainFrame:change!=='child-navigation',isSameDocument:false},payload.url,false,change!=='child-navigation')
  completeProbe(payload)
  await expect(reading).rejects.toThrow('变化')
  for(const event of ['did-start-navigation','did-navigate-in-page','render-process-gone','destroyed'])expect(wc.listenerCount(event)).toBe(0)
 })

 it('removes lifetime listeners after a normal successful read',async()=>{
  const a=new PlatformAdapter('chaoxing'),payload=page(),frame={url:payload.url,detached:false}
  Object.assign(frame,{framesInSubtree:[frame]})
  const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:frame,executeJavaScriptInIsolatedWorld:vi.fn().mockResolvedValue(payload)})
  expect(await a.read(wc as unknown as WebContents)).toEqual([payload])
  for(const event of ['did-start-navigation','did-navigate-in-page','render-process-gone','destroyed'])expect(wc.listenerCount(event)).toBe(0)
 })

 it('removes lifetime listeners when no probe could be read',async()=>{
  const a=new PlatformAdapter('chaoxing'),frame={url:page().url,detached:false}
  Object.assign(frame,{framesInSubtree:[frame]})
  const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:frame,executeJavaScriptInIsolatedWorld:vi.fn().mockRejectedValue(new Error('synthetic unavailable frame'))})
  await expect(a.read(wc as unknown as WebContents)).rejects.toThrow('无法读取')
  for(const event of ['did-start-navigation','did-navigate-in-page','render-process-gone','destroyed'])expect(wc.listenerCount(event)).toBe(0)
 })

 it('does not return a completed player when an allowed child frame could not be read',async()=>{
  const a=new PlatformAdapter('chaoxing'),payload={...page(),media:{state:'ended' as const,currentTime:10,duration:10,error:false}}
  const child={url:'https://mooc1.chaoxing.com/player',detached:false,executeJavaScript:vi.fn().mockRejectedValue(new Error('synthetic unavailable child'))}
  const frame={url:payload.url,detached:false,framesInSubtree:[] as unknown[]};frame.framesInSubtree=[frame,child]
  const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:frame,executeJavaScriptInIsolatedWorld:vi.fn().mockResolvedValue(payload)})
  await expect(a.read(wc as unknown as WebContents)).rejects.toThrow('嵌套页面')
  for(const event of ['did-start-navigation','did-navigate-in-page','render-process-gone','destroyed'])expect(wc.listenerCount(event)).toBe(0)
 })

 it('rejects an invalid child payload instead of ignoring its playback or challenge state',async()=>{
  const a=new PlatformAdapter('chaoxing'),payload=page()
  const child={url:'https://mooc1.chaoxing.com/player',detached:false,executeJavaScript:vi.fn().mockResolvedValue({media:{state:'unknown'}})}
  const frame={url:payload.url,detached:false,framesInSubtree:[] as unknown[]};frame.framesInSubtree=[frame,child]
  const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,mainFrame:frame,executeJavaScriptInIsolatedWorld:vi.fn().mockResolvedValue(payload)})
  await expect(a.read(wc as unknown as WebContents)).rejects.toThrow('嵌套页面')
 })
})
