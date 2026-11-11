import type { PageProbe, Recipe, ProbeOperation, PageItem } from './types'
import type { PageTarget, Completion } from '../../shared/contracts'
// Self-contained: this function is serialized into sandboxed platform frames.
// It never reads cookies, storage, passwords, networking internals, or hidden API state.
export async function probeDocument(recipe: Recipe, operation: ProbeOperation='read', target?: PageTarget): Promise<PageProbe> {
 const visible=(el: Element): boolean => { const box=el.getBoundingClientRect();const style=getComputedStyle(el);return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden' }
 const text=(el: Element): string => ((el as HTMLElement).innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180)
 const completion=(el: Element): Completion => {
  const markers=[el,...Array.from(el.querySelectorAll('[title],[aria-label],.status,.state'))].filter(visible)
  const marker=markers.flatMap(e=>[e.getAttribute('title'),e.getAttribute('aria-label'),e!==el&&e.matches('.status,.state')?text(e):'']).filter(Boolean).join(' ')
  const complete=recipe.completedSelectors.some(s=>[el,...Array.from(el.querySelectorAll(s))].some(e=>visible(e)&&e.matches(s)))||/已完成|学习完成|已学完/.test(marker)
  const incomplete=/未完成|未学习|学习中/.test(marker)
  if(incomplete)return complete?'unknown':'incomplete'
  return complete?'complete':'unknown'
 }
 const locked=(el: Element,context:Element=el): boolean => {
  const localText:string[]=[];let localRestriction=false
  const readLocal=(node:Node):void=>{
   if(node.nodeType===Node.TEXT_NODE){localText.push(node.textContent??'');return}
   if(!(node instanceof Element)||!visible(node))return
   if(node!==context&&node!==el&&!node.contains(el)&&recipe.chapterSelectors.some(s=>node.matches(s)))return
   const marker=[node.getAttribute('title'),node.getAttribute('aria-label')].filter(Boolean).join(' ')
   if(recipe.lockSelectors.some(s=>node.matches(s))||/未解锁|尚未开放|请先完成|前置任务/.test(marker))localRestriction=true
   for(const child of Array.from(node.childNodes))readLocal(child)
  }
  readLocal(context)
  if(localRestriction||/未解锁|尚未开放|请先完成|前置任务/.test(localText.join('').replace(/\s+/g,' ').trim().slice(0,180)))return true
  // An ancestor's own restriction applies to every child; a sibling's status does not.
  for(let ancestor:Element|null=el;ancestor;ancestor=ancestor.parentElement){
   const current=ancestor,marker=[current.getAttribute('title'),current.getAttribute('aria-label')].filter(Boolean).join(' ')
   if(recipe.lockSelectors.some(s=>current.matches(s))||/未解锁|尚未开放|请先完成|前置任务/.test(marker))return true
  }
  return false
 }
 const absolute=(raw: string|null): string => { if(!raw||/^(javascript:|#)/i.test(raw))return '';try{const u=new URL(raw,location.href);return u.protocol==='https:'?u.href:''}catch{return ''} }
 const chapterControls=()=>{
  const candidates=new Map<Element,{el:Element;selector:string;index:number}>()
  for(const selector of recipe.chapterSelectors){const els=Array.from(document.querySelectorAll(selector)).filter(visible);for(let index=0;index<els.length;index++){
   const el=els[index],title=text(el);if(title&&title.length<=160&&!candidates.has(el))candidates.set(el,{el,selector,index})
  }}
  const all=[...candidates.values()],parents=new Set<Element>()
  for(const c of all)for(let parent=c.el.parentElement;parent;parent=parent.parentElement)if(candidates.has(parent))parents.add(parent)
  const leaves=all.filter(c=>!parents.has(c.el))
  leaves.sort((a,b)=>a.el.compareDocumentPosition(b.el)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1)
  const seenLinks=new Set<Element>()
  const controls=leaves.flatMap(c=>{
   const link=c.el instanceof HTMLAnchorElement?c.el:c.el.querySelector('a[href]')??c.el.closest('a[href]')
   if(link&&seenLinks.has(link))return [];if(link)seenLinks.add(link)
   return [{...c,link}]
  })
  const counts=new Map<Element,number>()
  for(const c of controls)for(let parent:Element|null=c.el;parent;parent=parent.parentElement)if(candidates.has(parent))counts.set(parent,(counts.get(parent)??0)+1)
  return controls.map(c=>{
   // A single chapter may inherit its row's status; a group cannot identify one child.
   let context=c.el;const statusElements=[c.el,...(c.link?[c.link]:[])]
   for(let parent=c.el.parentElement;parent;parent=parent.parentElement)if(candidates.has(parent)&&counts.get(parent)===1){context=parent;statusElements.push(parent)}
   if(c.link?.contains(context))context=c.link
   return {...c,context,statusElements}
  })
 }
 if(operation==='pause')for(const v of Array.from(document.querySelectorAll('video,audio'))) (v as HTMLMediaElement).pause()
 if(operation==='click'){
  if(!target||!recipe.chapterSelectors.includes(target.selector))throw new Error('章节定位信息无效。')
  const control=chapterControls().find(c=>c.selector===target.selector&&c.index===target.index)
  if(!control||text(control.el)!==target.text||locked(control.el,control.context)||/测验|考试|作业|答题/.test(text(control.el)))throw new Error('章节内容或解锁状态已改变，请刷新。')
  const raw=control.link?.getAttribute('href')||''
  if(raw&&/^(javascript:|data:)/i.test(raw))throw new Error('此章节需要在平台页面手动打开。')
  ;(control.el as HTMLElement).click()
 }
 const media=Array.from(document.querySelectorAll('video')).filter(visible) as HTMLVideoElement[]
 if(operation==='play'){
  if(media.length!==1)throw new Error('无法唯一定位可见播放器，请在平台手动确认。')
  try{await media[0].play()}catch{throw new Error('平台要求你点击播放，请在工作台操作后恢复任务。')}
 }
 const password=Array.from(document.querySelectorAll('input[type="password"]')).some(visible)
 const loginForm=password||Array.from(document.querySelectorAll('form')).some(el=>visible(el)&&/扫码登录|验证码登录/.test(text(el)))
 const captcha=Array.from(document.querySelectorAll('[class*="captcha"],[id*="captcha"],.yidun_popup,.geetest_panel')).some(el=>visible(el)&&el.getBoundingClientRect().width>80&&el.getBoundingClientRect().height>50)
 const dialogs=Array.from(document.querySelectorAll('[role="dialog"],.modal,.dialog,.popup')).filter(visible)
 let issue: string|null=null
 if(captcha)issue='平台出现验证码，请在工作台人工完成。'
 else if(loginForm)issue='登录已失效或尚未登录，请先在平台页面登录。'
 else if(dialogs.some(el=>/答题|测验|人脸|身份验证|继续学习|确认学习/.test(text(el))))issue='平台需要人工答题、身份验证或确认，请在工作台处理。'
 const positiveLogin=recipe.loggedInSelectors.some(s=>Array.from(document.querySelectorAll(s)).some(visible))
 const courses: PageItem[]=[];const seen=new Set<string>()
 const personalPage=/我的课程|我学的课|我参与的|我的学习|共享课程|学分课程/.test((document.body?.innerText||'').slice(0,12000))||/studentcourse|mycourse|myCourse|home[.]htm|onlineweb.zhihuishu/.test(location.href)
 if(personalPage&&!loginForm)for(const selector of recipe.courseSelectors){for(const el of Array.from(document.querySelectorAll(selector)).filter(visible)){
  const a=el instanceof HTMLAnchorElement?el:el.querySelector('a[href]');const url=absolute(a?.getAttribute('href')||'');const title=text(el)
  if(!url||!title||title.length<2||seen.has(url)||!recipe.coursePatterns.some(p=>url.includes(p))||/SPOC|学校云|翻转课/i.test(title+' '+url))continue
  seen.add(url);courses.push({title,url,completion:completion(el),locked:false,kind:'unknown'})
 }}
 const controls=chapterControls(),chapters: PageItem[]=[]
 for(const {el,selector,index,link,context} of controls){
  const title=text(el),url=absolute(link?.getAttribute('href')||'')||location.href
  chapters.push({title,url,completion:completion(context),locked:locked(el,context),kind:/作业|测验|考试|答题/.test(title)?'manual':/视频|播放/.test(title)||el.matches('.video-item,.videoItem')?'video':'unknown',target:{selector,text:title,index,frameUrl:location.href}})
 }
 const video=media.length===1?media[0]:null
 // Candidate active markers are accepted only on one recognized chapter control.
 const active=controls.filter(c=>recipe.activeChapterSelectors.some(s=>c.statusElements.some(el=>visible(el)&&el.matches(s))))
 if(active.length>1&&!issue)issue='页面存在多个当前章节标记，无法可靠确认所选章节。'
 const current=active.length===1?active[0]:null
 return {url:location.href,title:document.title.slice(0,180),login:captcha?'attention':loginForm?'logged-out':positiveLogin?'logged-in':'unknown',issue,courses:courses.slice(0,300),chapters:chapters.slice(0,500),activeChapter:current?text(current.el):null,activeTarget:current?{selector:current.selector,text:text(current.el),index:current.index,frameUrl:location.href}:null,completion:current?completion(current.context):'unknown',media:video?{state:video.ended?'ended':video.paused?'paused':video.readyState<3?'buffering':'playing',currentTime:Number.isFinite(video.currentTime)?video.currentTime:0,duration:Number.isFinite(video.duration)?video.duration:0,error:!!video.error}:null}
}
