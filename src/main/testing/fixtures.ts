import type { Session } from 'electron'
import type { Account } from '../../shared/contracts'
import { platformOf } from '../../shared/platforms'
// This module is reachable only when !app.isPackaged AND CAMPUS_TEST_MODE=1.
// No fixture accounts or courses are ever seeded in the production application.
function wave(seconds:number):Buffer{
 const rate=8000,length=rate*seconds*2,b=Buffer.alloc(44+length);b.write('RIFF');b.writeUInt32LE(36+length,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length,40);return b
}
export function setupFixtureSession(ses:Session,account:Account):void{
 const platform=platformOf(account.platform);const audio=wave(8)
 ses.protocol.handle('https',request=>{
  const url=new URL(request.url)
  const v24=account.platform==='chaoxing'&&['v24目录测试','v24跳转测试','v24HTTPS测试','v24循环测试'].includes(account.label)
  const secureRetry=account.label==='v24HTTPS测试'||account.label==='v24循环测试'
  const legacyEntry='http://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=101&clazzid=201&cpi=301&ckenc=synthetic-hop-secret'
  if(v24&&url.pathname==='/courselist/opencoursenewfy'){
   if(url.searchParams.get('ckenc')!=='synthetic-signature')return new Response('测试：未取得当前目录入口',{status:403})
   if(account.label==='v24跳转测试')return new Response(null,{status:302,headers:{Location:'http://mooc1.chaoxing.com/mycourse/studentcourse?courseId=101&ckenc=synthetic-secret'}})
   if(secureRetry)return new Response(null,{status:302,headers:{Location:legacyEntry}})
   return new Response(null,{status:302,headers:{Location:'https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=101&clazzid=201&cpi=301'}})
  }
  if(secureRetry&&url.hostname==='mooc1.chaoxing.com'&&url.pathname==='/visit/stucoursemiddle'){
   if(url.searchParams.get('ckenc')!=='synthetic-hop-secret')return new Response('测试：中间入口参数缺失',{status:403})
   return new Response(null,{status:302,headers:{Location:account.label==='v24循环测试'?legacyEntry:'https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=101&clazzid=201&cpi=301'}})
  }
  if(url.pathname==='/fixture.wav'){
   const range=request.headers.get('range');const match=range?.match(/bytes=(\d+)-(\d*)/);const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),audio.length-1):audio.length-1
   return new Response(new Uint8Array(audio.subarray(start,end+1)),{status:match?206:200,headers:{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(match?{'Content-Range':'bytes '+start+'-'+end+'/'+audio.length}:{})}})
  }
  const origin=url.origin;const coursePath=account.platform==='chaoxing'?'/mooc-ans/visit/stucoursemiddle?courseid=fixture':account.platform==='icourse'?'/learn/fixture':'/learning/videoList?courseId=fixture';const chapterClass=account.platform==='chaoxing'?'chapter_item':account.platform==='icourse'?'j-lesson':'video-item';const isCourse=url.pathname.includes('stucoursemiddle')||url.pathname.includes('/learn/')||url.pathname.includes('videoList');const isChapter=url.searchParams.has('chapter');const ch=Number(url.searchParams.get('chapter')??0)
  const fixedChapterUrl=(n:number)=>origin+coursePath+(coursePath.includes('?')?'&':'?')+'chapter='+n
  const chapters=[0,1].map(n=>'<a class="'+chapterClass+'" '+(isChapter&&ch===n?'aria-current="true"':'')+' href="'+fixedChapterUrl(n)+'" data-completion="'+(isChapter&&ch===n?'incomplete':'unknown')+'">视频 '+(n+1)+' · 明确标注的测试章节</a>').join('')
  const listing=account.platform==='chaoxing'
   ? v24&&url.pathname==='/wfw/courselist/course3'
    ? '<h2>我学的课</h2><ul id="stuCourseList"><li><a target="_blank" href="https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301&ckenc=synthetic-signature">本课程已结课</a><h3><a target="_blank" href="https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301&ckenc=synthetic-signature">测试课程 · v24目录</a></h3></li></ul>'
    : v24&&!isCourse
    ? '<h2>测试个人空间 · 非真实平台</h2><iframe title="测试v24课程目录" src="https://v24.chaoxing.com/wfw/courselist/course3?space_token=synthetic-context" style="width:95%;height:450px;border:0"></iframe>'
    : url.pathname==='/visit/interaction'
    ? '<h2>我学的课</h2><ul id="courseList"><li><a href="'+origin+coursePath+'"><span aria-hidden="true"></span></a><h3><a href="'+origin+coursePath+'">测试课程 · '+platform.name+'</a></h3><p>示例学校 · 示例教师</p></li></ul>'
    : '<h2>测试个人空间 · 非真实平台</h2><iframe title="测试课程目录" src="https://mooc1-2.chaoxing.com/visit/interaction?s=synthetic-context" style="width:95%;height:450px;border:0"></iframe>'
   : '<h2>我的课程</h2><div class="course-list"><a href="'+origin+coursePath+'">测试课程 · '+platform.name+'</a></div>'
  const body=isCourse?'<h2>测试课程 · 不是真实平台课程</h2><section>'+chapters+'</section>'+(isChapter?'<video '+(process.env.CAMPUS_SOAK==='1'?'loop ':'')+'controls muted preload="auto" style="display:block;width:640px;height:320px;background:#172a34" src="/fixture.wav"></video><p>本地生成的静音媒体夹具，用于验证真实 HTML 媒体事件；不代表课程兼容。</p>':'<p>请选择章节。</p>'):listing
  const html='<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>测试夹具 · '+platform.name+'</title><style>body{font:15px Segoe UI,sans-serif;padding:30px;color:#294750;background:#f5faf9}a{display:block;padding:15px;background:white;margin:10px 0;color:#188579;border:1px solid #dbeae5}aside{background:#fff2c9;padding:16px;margin-bottom:24px}section{display:flex;gap:12px}p{font-size:12px;color:#648580}</style></head><body><aside>自动化测试夹具 — 非真实平台，非真实账号</aside><a href="'+origin+'/logout">退出登录</a>'+body+'<script>document.cookie="fixtureAccount='+account.id+'; Secure; SameSite=Lax";document.querySelector("video")?.addEventListener("ended",()=>{document.querySelector("[aria-current]")?.setAttribute("data-completion","complete")})</script></body></html>'
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src 'self'; frame-src 'self' https://mooc1-2.chaoxing.com https://v24.chaoxing.com"}})
 })
}
