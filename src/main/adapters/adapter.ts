import { z } from 'zod'
import type { WebContents, WebFrameMain } from 'electron'
import type { Account, Course, Chapter, PlatformId, Observation, Task } from '../../shared/contracts'
import type { PageProbe, ProbeOperation } from './types'
import { recipes } from './recipes'
import { probeDocument } from './probe'
import { fingerprint, isAllowedUrl, isPersistableCourseUrl, courseIdentityUrl, isDirectoryCourse } from '../core/security'
const targetSchema=z.object({selector:z.string().max(120),text:z.string().max(180),index:z.number().int().min(0).max(1000),frameUrl:z.string().max(8192)})
const item=z.object({title:z.string().min(1).max(180),url:z.string().max(8192),completion:z.enum(['complete','incomplete','unknown']),locked:z.boolean(),kind:z.enum(['video','manual','unknown']),target:targetSchema.optional()})
const schema=z.object({activeChapter:z.string().max(180).nullable(),url:z.string().max(8192),title:z.string().max(180),login:z.enum(['unknown','logged-in','logged-out','attention']),issue:z.string().max(300).nullable(),courses:z.array(item).max(300),chapters:z.array(item).max(500),completion:z.enum(['complete','incomplete','unknown']),media:z.object({state:z.enum(['playing','paused','ended','buffering']),currentTime:z.number().min(0),duration:z.number().min(0),error:z.boolean()}).nullable()})
export async function within<T>(promise: Promise<T>, ms=7000): Promise<T> { let timer:ReturnType<typeof setTimeout>;return Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('页面响应超时，请检查网络或人工刷新。')),ms)})]).finally(()=>clearTimeout(timer)) }
export class PlatformAdapter {
 constructor(readonly platform: PlatformId) {}
 private frames(contents: WebContents): WebFrameMain[] { return contents.mainFrame.framesInSubtree.filter(f=>!f.detached&&isAllowedUrl(this.platform,f.url)).slice(0,20) }
 async read(contents: WebContents): Promise<PageProbe[]> {
  if(contents.isDestroyed())throw new Error('学习页面已关闭。')
  const frames=this.frames(contents);if(!frames.length)throw new Error('当前页面不是已允许的平台页面。')
  const output=await Promise.all(frames.map(async frame=>{
   try {const code='('+probeDocument.toString()+')('+JSON.stringify(recipes[this.platform])+',"read")';const value=frame===contents.mainFrame?await within(contents.executeJavaScriptInIsolatedWorld(1001,[{code}])):await within(frame.executeJavaScript(code));return schema.parse(value) as PageProbe }catch{return null}
  }));const probes=output.filter((p):p is PageProbe=>p!==null);if(!probes.length)throw new Error('无法读取课程页面，页面结构可能已变化。');return probes
 }
 async operate(contents: WebContents, operation: ProbeOperation, chapter?: Chapter): Promise<void> {
  let frames=this.frames(contents)
  if(operation==='click')frames=frames.filter(f=>f.url===chapter?.target?.frameUrl)
  if(!frames.length)throw new Error('章节所在页面已变化，请重新读取。')
  let success=false
  for(const frame of frames){try{
   const code='('+probeDocument.toString()+')('+JSON.stringify(recipes[this.platform])+','+JSON.stringify(operation)+','+JSON.stringify(chapter?.target??null)+')'
   if(frame===contents.mainFrame)await within(contents.executeJavaScriptInIsolatedWorld(1001,[{code}]))
   else await within(frame.executeJavaScript(code))
   success=true;if(operation==='click')break
  }catch(error){if(operation==='click')throw error}}
  if(!success)throw new Error(operation==='play'?'播放未能启动，请在工作台点击平台的播放按钮。':'无法控制页面，请手动处理。')
 }
 async courses(contents: WebContents, account: Account): Promise<Course[]> {
  const probes=await this.read(contents);const issue=probes.find(p=>p.issue)?.issue;if(issue)throw new Error(issue)
  const output=new Map<string,Course>()
  for(const p of probes)for(const c of p.courses){const url=courseIdentityUrl(this.platform,c.url);if(url){const id=fingerprint(account.id+'|'+url);output.set(id,{id,accountId:account.id,platform:this.platform,title:c.title,url,updatedAt:Date.now(),completion:c.completion})}}
  if(!output.size)throw new Error(this.platform==='chaoxing'
   ? '未识别到个人课程。请在工作台内点学习通自己的“课程”，看到“我学的课”和课程封面后再刷新；课表不是网课目录。如果已经在该页面，说明当前结构仍需适配。'
   : '未可靠识别到个人课程。请在工作台打开“我的课程”后重试；该页面可能尚未适配。')
  return [...output.values()]
 }
 async resolveCourseUrl(contents:WebContents,course:Course):Promise<string>{
  if(!isDirectoryCourse(this.platform,course.url)){
   if(!isPersistableCourseUrl(this.platform,course.url))throw new Error('课程入口含有临时凭据，请重新读取课程。')
   return course.url
  }
  const probes=await this.read(contents);const issue=probes.find(p=>p.issue)?.issue;if(issue)throw new Error(issue)
  const matches=[...new Set(probes.flatMap(p=>p.courses).filter(c=>courseIdentityUrl(this.platform,c.url)===course.url).map(c=>c.url))]
  if(matches.length!==1)throw new Error('请在工作台打开学习通“课程 → 我学的课”，刷新课程后重试。此课程需从当前账号的目录取得临时入口，应用不会保存或复用旧签名。')
  return matches[0]
 }
 async chapters(contents: WebContents, course: Course): Promise<Chapter[]> {
  const probes=await this.read(contents);const issue=probes.find(p=>p.issue)?.issue;if(issue)throw new Error(issue)
  const output=new Map<string,Chapter>()
  for(const p of probes)for(const c of p.chapters)if(isPersistableCourseUrl(this.platform,c.url)&&(!c.target||isPersistableCourseUrl(this.platform,c.target.frameUrl))){const id=fingerprint(course.id+'|'+c.title+'|'+c.url);if(!output.has(id))output.set(id,{id,courseId:course.id,title:c.title,url:c.url,kind:c.kind,locked:c.locked,completion:c.completion,target:c.target})}
  if(!output.size)throw new Error('未可靠识别章节。请打开课程章节目录；当前结构可能尚未适配。')
  return [...output.values()]
 }
 async observation(contents: WebContents, task: Task): Promise<Observation> {
  const probes=await this.read(contents);const mediaPages=probes.filter(p=>p.media);const current=mediaPages[0];const chapter=task.chapters[task.chapterIndex]
  let issue=probes.find(p=>p.issue)?.issue??null
  if(mediaPages.length>1)issue='页面存在多个播放器，无法可靠确认当前章节。'
  if(current?.media?.error)issue='播放器报告错误，请检查网络或课程访问权限。'
  const active=probes.filter(p=>p.activeChapter);const expected=chapter.target?.text??chapter.title
  if(active.some(p=>p.activeChapter!==expected))issue='当前播放器对应的章节发生变化，请重新读取章节，未自动推进任务。'
  if(!active.length&&chapter.target&&chapter.url===chapter.target.frameUrl)issue='无法核对播放器与所选章节的对应关系，请在平台人工确认。'
  const completion=active.find(p=>p.activeChapter===expected)?.completion??'unknown'
  return {taskId:task.id,accountId:task.accountId,chapterId:chapter.id,generation:task.generation,observedAt:Date.now(),state:current?.media?.state??'unknown',currentTime:current?.media?.currentTime??0,duration:current?.media?.duration??0,completion,issue,url:contents.getURL()}
 }
}
