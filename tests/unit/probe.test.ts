// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { probeDocument } from '../../src/main/adapters/probe'
import { recipes } from '../../src/main/adapters/recipes'
import { platformIds } from '../../src/shared/contracts'
function media(values:Record<string,unknown>={}){const v=document.createElement('video');document.body.append(v);for(const [k,value] of Object.entries({currentTime:3,duration:10,ended:false,paused:false,readyState:4,error:null,...values}))Object.defineProperty(v,k,{value,configurable:true});return v}
beforeEach(()=>{document.body.innerHTML='';Object.defineProperty(document.body,'innerText',{configurable:true,get:()=>document.body.textContent});vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:200,height:80,top:0,left:0,right:200,bottom:80,toJSON:()=>({})});vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{})})
afterEach(()=>{Reflect.deleteProperty(document.body,'innerText');vi.restoreAllMocks()})
// De-identified reconstruction of the accessible course-list structure observed
// on the user's page, not a saved page or a claim of real-course acceptance.
function personalCourses(){document.body.innerHTML=`<nav>我学的课 我教的课</nav><ul id="courseList">
 <li><a href="https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=101&clazzid=201&cpi=301"><img alt=""></a><h3><a href="https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=101&clazzid=201&cpi=301">测试课程甲</a></h3><p>示例学校 示例教师</p></li>
 <li><a href="https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=102&clazzid=202&cpi=301">课程已结束</a><h3><a href="https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=102&clazzid=202&cpi=301">测试课程乙</a></h3></li>
 </ul>`}
it('reads personal heading links without cover duplicates, teacher names or ended-status titles',async()=>{personalCourses();const r=await probeDocument(recipes.chaoxing);expect(r.courses.map(c=>c.title)).toEqual(['测试课程甲','测试课程乙']);expect(r.courses.every(c=>c.completion==='unknown')).toBe(true);expect(r.courses[0].url).toContain('/visit/stucoursemiddle?');expect(r.courses.every(c=>!c.target)).toBe(true)})
it('does not treat a weekly timetable as the personal course list',async()=>{document.body.innerHTML='<h2>我的课表</h2><table><tr><td>周一 测试课程甲</td></tr></table>';expect((await probeDocument(recipes.chaoxing)).courses).toEqual([])})
it('requires personal-course context and does not import a public catalogue',async()=>{personalCourses();document.querySelector('nav')!.remove();expect((await probeDocument(recipes.chaoxing)).courses).toEqual([])})
it('does not import personal courses through a visible login challenge',async()=>{personalCourses();document.body.insertAdjacentHTML('afterbegin','<input type="password">');const r=await probeDocument(recipes.chaoxing);expect(r.courses).toEqual([]);expect(r.login).toBe('logged-out')})
it('deduplicates repeated heading URLs but preserves different courses with equal names',async()=>{personalCourses();const list=document.querySelector('#courseList')!;list.insertAdjacentHTML('beforeend',list.firstElementChild!.outerHTML);document.querySelectorAll('h3 a')[1].textContent='测试课程甲';expect((await probeDocument(recipes.chaoxing)).courses.map(c=>c.title)).toEqual(['测试课程甲','测试课程甲'])})
it('excludes hidden course headings',async()=>{personalCourses();(document.querySelector('h3 a') as HTMLElement).style.display='none';expect((await probeDocument(recipes.chaoxing)).courses.map(c=>c.title)).toEqual(['测试课程乙'])})
it('reads the observed v24 heading structure without treating course closure as completion',async()=>{
 document.body.innerHTML='<nav>我学的课 我教的课</nav><ul id="stuCourseList"><li><a href="https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301&ckenc=synthetic">本课程已结课</a><h3><a href="https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301&ckenc=synthetic">脱敏课程甲</a></h3><p>示例教师</p></li></ul>'
 const result=await probeDocument(recipes.chaoxing)
 expect(result.courses).toHaveLength(1);expect(result.courses[0].title).toBe('脱敏课程甲');expect(result.courses[0].completion).toBe('unknown')
})
it.each(platformIds)('reads candidate chapter structure for %s without asserting real compatibility',async p=>{const cls=p==='chaoxing'?'chapter_item':p==='icourse'?'j-lesson':'video-item';document.body.innerHTML='<a class="'+cls+'" href="https://www.chaoxing.com/course/1">视频 第一章</a>';const r=await probeDocument(recipes[p]);expect(r.chapters).toHaveLength(1);expect(r.chapters[0].kind).toBe('video')})
it('reads visible media state and explicit ended',async()=>{media();let r=await probeDocument(recipes.chaoxing);expect(r.media?.state).toBe('playing');document.querySelector('video')!.remove();media({ended:true,currentTime:10});r=await probeDocument(recipes.chaoxing);expect(r.media?.state).toBe('ended')})
it('does not infer ended solely from matching times',async()=>{media({currentTime:10,paused:true});expect((await probeDocument(recipes.chaoxing)).media?.state).toBe('paused')})
it('does not choose among multiple visible videos',async()=>{media();media();expect((await probeDocument(recipes.chaoxing)).media).toBeNull();await expect(probeDocument(recipes.chaoxing,'play')).rejects.toThrow('唯一')})
it('ignores hidden login fields',async()=>{document.body.innerHTML='<input type="password" style="display:none">';expect((await probeDocument(recipes.chaoxing)).login).toBe('unknown')})
it('detects login without reading password or cookies',async()=>{document.body.innerHTML='<input type="password" value="secret-do-not-read">';vi.spyOn(HTMLInputElement.prototype,'value','get').mockImplementation(()=>{throw Error('password read')});vi.spyOn(document,'cookie','get').mockImplementation(()=>{throw Error('cookie read')});const r=await probeDocument(recipes.chaoxing);expect(r.login).toBe('logged-out');expect(JSON.stringify(r)).not.toContain('secret-do-not-read')})
it('detects visible captcha and stops for human action',async()=>{document.body.innerHTML='<div class="captcha">校验</div>';const r=await probeDocument(recipes.chaoxing);expect(r.login).toBe('attention');expect(r.issue).toContain('验证码')})
it('detects manual assessment dialog',async()=>{document.body.innerHTML='<div role="dialog">请完成答题</div>';expect((await probeDocument(recipes.chaoxing)).issue).toContain('人工')})
it('detects locked and assessment chapters separately',async()=>{document.body.innerHTML='<a class="chapter_item locked">视频 未解锁</a><a class="chapter_item">章节测验</a>';const r=await probeDocument(recipes.chaoxing);expect(r.chapters[0].locked).toBe(true);expect(r.chapters[1].kind).toBe('manual')})
it('only explicit completion is complete',async()=>{document.body.innerHTML='<a class="chapter_item" aria-current="true" title="未完成">视频</a>';expect((await probeDocument(recipes.chaoxing)).completion).toBe('incomplete');document.querySelector('a')!.setAttribute('title','已完成');expect((await probeDocument(recipes.chaoxing)).completion).toBe('complete')})
it('refuses stale click targets',async()=>{document.body.innerHTML='<a class="chapter_item">changed</a>';await expect(probeDocument(recipes.chaoxing,'click',{selector:'.chapter_item',text:'original',index:0,frameUrl:location.href})).rejects.toThrow('改变')})
it('refuses JavaScript chapter links',async()=>{document.body.innerHTML='<a class="chapter_item" href="javascript:alert(1)">视频</a>';await expect(probeDocument(recipes.chaoxing,'click',{selector:'.chapter_item',text:'视频',index:0,frameUrl:location.href})).rejects.toThrow('手动')})
it('pauses audio and video without manipulating progress',async()=>{const v=media();document.body.append(document.createElement('audio'));await probeDocument(recipes.chaoxing,'pause');expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);expect(v.currentTime).toBe(3)})

describe('chapter control identity and visible status',()=>{
 it('keeps DOM order across selector variants and excludes parent groups',async()=>{
  document.body.innerHTML='<section class="chapter_unit" data-completion="complete"><a class="posCatalog_name" href="https://www.chaoxing.com/knowledge/cards?chapterId=1">视频 第一节</a><a class="chapter_item" href="https://www.chaoxing.com/knowledge/cards?chapterId=2">视频 第二节</a></section>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters.map(c=>c.title)).toEqual(['视频 第一节','视频 第二节'])
  expect(r.chapters.map(c=>c.completion)).toEqual(['unknown','unknown'])
  expect(r.chapters.map(c=>c.target?.selector)).toEqual(['.posCatalog_name','.chapter_item'])
 })
 it('deduplicates overlapping selectors for the same control',async()=>{
  document.body.innerHTML='<a class="chapter_item posCatalog_name" href="https://www.chaoxing.com/knowledge/cards?chapterId=1">视频 第一节</a>'
  expect((await probeDocument(recipes.chaoxing)).chapters).toHaveLength(1)
 })
 it('preserves different in-page controls with the same title and URL',async()=>{
  document.body.innerHTML='<button class="chapter_item">视频 导论</button><button class="chapter_item">视频 导论</button>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters).toHaveLength(2);expect(r.chapters.map(c=>c.target?.index)).toEqual([0,1])
  expect(r.chapters[0].url).toBe(r.chapters[1].url)
 })
 it('inherits one chapter row status and lock while retaining its leaf title',async()=>{
  document.body.innerHTML='<a class="chapter_item current" aria-disabled="true"><span class="posCatalog_name">视频 第一节</span><i class="status">未完成</i></a>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters).toHaveLength(1);expect(r.chapters[0]).toMatchObject({title:'视频 第一节',completion:'incomplete',locked:true})
  expect(r.activeChapter).toBe('视频 第一节');expect(r.activeTarget).toEqual(r.chapters[0].target)
  await expect(probeDocument(recipes.chaoxing,'click',r.chapters[0].target)).rejects.toThrow('解锁状态')
 })
 it('retains an intermediate chapter row active marker under a single-item wrapper',async()=>{
  document.body.innerHTML='<section class="chapter_unit"><div class="chapter_item current"><span class="posCatalog_name">视频 第一节</span></div></section>'
  expect((await probeDocument(recipes.chaoxing)).activeChapter).toBe('视频 第一节')
 })
 it('keeps one action and its row status when an anchor contains repeated labels',async()=>{
  document.body.innerHTML='<a class="chapter_item current" aria-disabled="true" href="https://www.chaoxing.com/course/1"><span class="posCatalog_name">视频 第一节</span><span class="posCatalog_name">视频 第一节</span><i class="status">未完成</i></a>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters).toHaveLength(1);expect(r.chapters[0]).toMatchObject({completion:'incomplete',locked:true})
  expect(r.activeChapter).toBe('视频 第一节')
 })
 it('ignores a hidden completed marker on a visibly incomplete chapter',async()=>{
  document.body.innerHTML='<a class="chapter_item current" title="未完成">视频 第一节<i style="display:none" data-completion="complete"></i></a>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters[0].completion).toBe('incomplete');expect(r.completion).toBe('incomplete')
 })
 it('keeps conflicting visible completion markers unknown',async()=>{
  document.body.innerHTML='<a class="chapter_item current" title="未完成" data-completion="complete">视频 第一节</a>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters[0].completion).toBe('unknown');expect(r.completion).toBe('unknown')
 })
 it('does not use hidden text status as completion evidence',async()=>{
  document.body.innerHTML='<a class="chapter_item">视频 第一节<i class="status" style="display:none">已完成</i></a>'
  expect((await probeDocument(recipes.chaoxing)).chapters[0].completion).toBe('unknown')
 })
 it('ignores current navigation and a current parent group',async()=>{
  document.body.innerHTML='<nav aria-current="true">我的课程</nav><section class="chapter_unit current"><a class="chapter_item">视频 第一节</a><a class="chapter_item">视频 第二节</a></section>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.activeChapter).toBeNull();expect(r.activeTarget).toBeNull()
 })
 it('reads candidate active markers on the supported videoItem variant',async()=>{
  document.body.innerHTML='<button class="videoItem active">导论</button>'
  const r=await probeDocument(recipes.zhihuishu)
  expect(r.activeChapter).toBe('导论');expect(r.activeTarget).toMatchObject({selector:'.videoItem',index:0})
 })
 it('keeps the active position for chapters with equal titles',async()=>{
  document.body.innerHTML='<button class="chapter_item">视频 导论</button><button class="chapter_item" aria-current="true">视频 导论</button>'
  expect((await probeDocument(recipes.chaoxing)).activeTarget).toMatchObject({selector:'.chapter_item',text:'视频 导论',index:1})
 })
 it('reports multiple active chapters without choosing or claiming completion',async()=>{
  document.body.innerHTML='<button class="chapter_item current" data-completion="complete">视频 导论</button><button class="chapter_item" aria-current="true">视频 导论</button>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.issue).toContain('多个当前章节');expect(r.activeChapter).toBeNull();expect(r.activeTarget).toBeNull();expect(r.completion).toBe('unknown')
 })
 it('refuses an obsolete group target after finding individual controls',async()=>{
  document.body.innerHTML='<section class="chapter_unit"><a class="chapter_item">视频 第一节</a><a class="chapter_item">视频 第二节</a></section>'
  await expect(probeDocument(recipes.chaoxing,'click',{selector:'.chapter_unit',text:'视频 第一节视频 第二节',index:0,frameUrl:location.href})).rejects.toThrow('改变')
 })
 it.each(['aria-disabled="true"','data-locked="true"'])('inherits a multi-chapter group restriction: %s',async restriction=>{
  document.body.innerHTML='<section class="chapter_unit" '+restriction+'><a class="chapter_item">视频 第一节</a><a class="chapter_item">视频 第二节</a></section>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters).toHaveLength(2);expect(r.chapters.map(c=>c.locked)).toEqual([true,true])
  expect(r.activeChapter).toBeNull();expect(r.chapters.map(c=>c.completion)).toEqual(['unknown','unknown'])
 })
 it.each(['disabled','data-locked="true"','title="尚未开放"','aria-label="请先完成前置任务"'])('respects a noncandidate wrapper restriction: %s',async restriction=>{
  document.body.innerHTML='<div '+restriction+'><a class="chapter_item">视频 第一节</a><a class="chapter_item">视频 第二节</a></div>'
  expect((await probeDocument(recipes.chaoxing)).chapters.map(c=>c.locked)).toEqual([true,true])
 })
 it('does not transfer a sibling restriction or lock text to an unlocked chapter',async()=>{
  document.body.innerHTML='<section class="chapter_unit"><a class="chapter_item">视频 第一节</a><a class="chapter_item" data-locked="true">视频 第二节 未解锁</a></section>'
  expect((await probeDocument(recipes.chaoxing)).chapters.map(c=>c.locked)).toEqual([false,true])
 })
 it('does not read a hidden sibling restriction through an ancestor context',async()=>{
  document.body.innerHTML='<section class="chapter_unit"><a class="chapter_item">视频 第一节</a><a class="chapter_item" style="display:none" data-locked="true">视频 第二节 未解锁</a></section>'
  const r=await probeDocument(recipes.chaoxing)
  expect(r.chapters).toHaveLength(1);expect(r.chapters[0].locked).toBe(false)
 })
 it('retains one chapter row visible text restriction outside its title leaf',async()=>{
  document.body.innerHTML='<a class="chapter_item"><span class="posCatalog_name">视频</span><i class="status">未解锁</i></a>'
  const r=await probeDocument(recipes.chaoxing),click=vi.spyOn(document.querySelector('.posCatalog_name') as HTMLElement,'click').mockImplementation(()=>{})
  expect(r.chapters).toHaveLength(1);expect(r.chapters[0]).toMatchObject({title:'视频',locked:true})
  await expect(probeDocument(recipes.chaoxing,'click',r.chapters[0].target)).rejects.toThrow('解锁状态')
  expect(click).not.toHaveBeenCalled()
 })
 it.each(['section class="chapter_unit"','div'])('refuses a stale click when an ancestor becomes restricted: %s',async wrapper=>{
  document.body.innerHTML='<'+wrapper+'><a class="chapter_item">视频 第一节</a><a class="chapter_item">视频 第二节</a></'+wrapper.split(' ')[0]+'>'
  const r=await probeDocument(recipes.chaoxing),click=vi.spyOn(document.querySelector('a') as HTMLElement,'click').mockImplementation(()=>{})
  document.body.firstElementChild!.setAttribute('aria-disabled','true')
  await expect(probeDocument(recipes.chaoxing,'click',r.chapters[0].target)).rejects.toThrow('解锁状态')
  expect(click).not.toHaveBeenCalled()
 })
})
