import type { PageProbe, Recipe, ProbeOperation, PageItem } from './types'
import type { PageTarget, Completion } from '../../shared/contracts'
// Self-contained: this function is serialized into sandboxed platform frames.
// It never reads cookies, storage, passwords, networking internals, or hidden API state.
export async function probeDocument(recipe: Recipe, operation: ProbeOperation='read', target?: PageTarget): Promise<PageProbe> {
 const visible=(el: Element): boolean => { const box=el.getBoundingClientRect();const style=getComputedStyle(el);return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden' }
 const text=(el: Element): string => ((el as HTMLElement).innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180)
 const matches=(el: Element, selectors: string[]): boolean => selectors.some(s=>el.matches(s)||!!el.querySelector(s))
 const completion=(el: Element): Completion => {
  if(matches(el,recipe.completedSelectors))return 'complete'
  const marker=[el.getAttribute('title'),el.getAttribute('aria-label'),...Array.from(el.querySelectorAll('[title],[aria-label],.status,.state')).map(e=>e.getAttribute('title')||e.getAttribute('aria-label')||text(e))].filter(Boolean).join(' ')
  if(/未完成|未学习|学习中/.test(marker))return 'incomplete'
  return /已完成|学习完成|已学完/.test(marker)?'complete':'unknown'
 }
 const locked=(el: Element): boolean => matches(el,recipe.lockSelectors)||/未解锁|尚未开放|请先完成|前置任务/.test(text(el))
 const absolute=(raw: string|null): string => { if(!raw||/^(javascript:|#)/i.test(raw))return '';try{const u=new URL(raw,location.href);return u.protocol==='https:'?u.href:''}catch{return ''} }
 if(operation==='pause')for(const v of Array.from(document.querySelectorAll('video,audio'))) (v as HTMLMediaElement).pause()
 if(operation==='click'){
  if(!target||!recipe.chapterSelectors.includes(target.selector))throw new Error('章节定位信息无效。')
  const candidates=Array.from(document.querySelectorAll(target.selector)).filter(visible)
  const el=candidates[target.index]
  if(!el||text(el)!==target.text||locked(el)||/测验|考试|作业|答题/.test(text(el)))throw new Error('章节内容或解锁状态已改变，请刷新。')
  const link=el instanceof HTMLAnchorElement?el:el.querySelector('a')
  const raw=link?.getAttribute('href')||''
  if(raw&&/^(javascript:|data:)/i.test(raw))throw new Error('此章节需要在平台页面手动打开。')
  ;(el as HTMLElement).click()
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
 const chapters: PageItem[]=[];const chapterSeen=new Set<string>()
 for(const selector of recipe.chapterSelectors){const els=Array.from(document.querySelectorAll(selector)).filter(visible);for(let index=0;index<els.length;index++){
  const el=els[index];const title=text(el);if(!title||title.length>160)continue
  const link=el instanceof HTMLAnchorElement?el:el.querySelector('a[href]');const url=absolute(link?.getAttribute('href')||'')||location.href
  const key=title+'|'+url;if(chapterSeen.has(key))continue;chapterSeen.add(key)
  chapters.push({title,url,completion:completion(el),locked:locked(el),kind:/作业|测验|考试|答题/.test(title)?'manual':/视频|播放/.test(title)||el.matches('.video-item,.videoItem')?'video':'unknown',target:{selector,text:title,index,frameUrl:location.href}})
 }}
 const video=media.length===1?media[0]:null
 const activeChapter=Array.from(document.querySelectorAll('[aria-current="true"],.chapter_item.current,.video-item.active,.j-lesson.current')).find(visible)
 return {url:location.href,title:document.title.slice(0,180),login:captcha?'attention':loginForm?'logged-out':positiveLogin?'logged-in':'unknown',issue,courses:courses.slice(0,300),chapters:chapters.slice(0,500),activeChapter:activeChapter?text(activeChapter):null,completion:activeChapter?completion(activeChapter):'unknown',media:video?{state:video.ended?'ended':video.paused?'paused':video.readyState<3?'buffering':'playing',currentTime:Number.isFinite(video.currentTime)?video.currentTime:0,duration:Number.isFinite(video.duration)?video.duration:0,error:!!video.error}:null}
}
