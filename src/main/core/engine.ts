import { randomUUID } from 'node:crypto'
import type { PlatformId, Task, Course, Chapter, Observation, Notice } from '../../shared/contracts'
import { platformIds, terminalStatuses } from '../../shared/contracts'
import type { Repository } from './repository'
export interface PlaybackRuntime {
 open(task: Task, chapter: Chapter): Promise<void>; play(task: Task): Promise<void>; observe(task: Task): Promise<Observation>;
 close(platform: PlatformId, taskId?: string): void; pause(task: Task): Promise<void>;
}
export class TaskEngine {
 private enabled = new Set<PlatformId>(); private busy = new Set<PlatformId>(); private last = new Map<string, Observation>(); private failures = new Map<string, number>(); private uncertain = new Map<string, number>(); private settlingUntil = new Map<string, number>(); private transitioning = new Set<PlatformId>();
 constructor(private repo: Repository, private runtime: PlaybackRuntime, private changed: ()=>void, private notify: (notice: Notice)=>void, private clock: ()=>number = Date.now) {}
 private save(t: Task): void { t.updatedAt=this.clock(); this.repo.saveTask(t); this.changed() }
 private notice(title: string, body: string): void { const n:Notice={id:randomUUID(),level:'warning',title,body,createdAt:this.clock(),read:false}; this.repo.saveNotice(n);this.notify(n);this.changed() }
 private forget(id:string):void {this.last.delete(id);this.failures.delete(id);this.uncertain.delete(id);this.settlingUntil.delete(id)}
 private find(id: string): Task { const t=this.repo.tasks().find(t=>t.id===id);if(!t)throw new Error('找不到这项任务。');return t }
 private current(t: Task): Task | undefined { return this.repo.tasks().find(x=>x.id===t.id&&x.generation===t.generation&&x.status==='running') }
 restore(): void { for(const t of this.repo.tasks())if(t.status==='running'){t.status='recoverable';t.playbackState='unknown';t.reason='应用上次运行已中断，请确认恢复并重新核对平台状态。';t.generation++;this.repo.saveTask(t)} }
 add(course: Course, chapters: Chapter[], selected: string[]): Task {
  if(!chapters.length)throw new Error('尚未可靠读取到章节，请先在学习工作台打开课程并刷新章节。')
  const unique=[...new Set(selected)]; if(unique.some(id=>!chapters.some(c=>c.id===id)))throw new Error('章节列表已经变化，请刷新后重新选择。')
  const chosen=unique.length?chapters.filter(c=>unique.includes(c.id)):chapters.filter(c=>c.completion!=='complete')
  if(!chosen.length)throw new Error('没有需要加入的章节。')
  if(this.repo.tasks().some(t=>t.courseId===course.id&&!terminalStatuses.includes(t.status)))throw new Error('这门课程已有未结束的任务，请先完成或取消。')
  const now=this.clock();const t:Task={id:randomUUID(),platform:course.platform,accountId:course.accountId,courseId:course.id,title:course.title,chapterIds:chosen.map(c=>c.id),chapters:chosen,chapterIndex:0,status:'queued',reason:null,createdAt:now,updatedAt:now,position:Math.max(0,...this.repo.tasks().map(t=>t.position))+1,currentTime:0,duration:0,playbackEnded:false,platformCompletion:'unknown',generation:0};this.save(t);this.repo.log('task-added',{taskId:t.id,platform:t.platform});return t
 }
 async start(platform: PlatformId): Promise<void> {
  const hold=this.repo.tasks().find(t=>t.platform===platform&&!terminalStatuses.includes(t.status)&&t.status!=='queued')
  if(hold){if(hold.status==='running')return;throw new Error('该平台有暂停或待处理任务，请先恢复或取消它。')}
  this.enabled.add(platform);await this.next(platform)
 }
 private async next(platform: PlatformId): Promise<void> {
  if(!this.enabled.has(platform)||this.transitioning.has(platform))return
  if(this.repo.tasks().some(t=>t.platform===platform&&!terminalStatuses.includes(t.status)&&t.status!=='queued'))return
  const task=this.repo.tasks().find(t=>t.platform===platform&&t.status==='queued');if(task)await this.launch(task)
 }
 private async launch(task: Task): Promise<void> {
  if(this.transitioning.has(task.platform))throw new Error('该平台正在切换任务，请稍后再试。')
  this.transitioning.add(task.platform)
  task.status='running';task.playbackState='unknown';task.observedAt=undefined;task.reason=null;task.generation++;task.platformCompletion='unknown';this.save(task)
  this.last.delete(task.id);this.failures.delete(task.id);this.uncertain.delete(task.id)
  try {
   const chapter=task.chapters[task.chapterIndex];if(!chapter)throw new Error('无法确认当前章节，请重新读取课程。')
   if(chapter.locked&&!chapter.target)throw new Error('章节尚未解锁，需要在平台人工处理。')
   if(chapter.kind==='manual')throw new Error('这一章节需要答题、作业或人工确认，请在平台处理后重新读取章节。')
   await this.runtime.open(task,chapter);if(!this.current(task))return
   const first=await this.runtime.observe(task);if(!this.current(task))return
   if(first.issue)throw new Error(first.issue)
   // Never infer completion or seek based on a persisted local checkpoint.
   if(first.state==='ended')throw new Error('当前章节已经显示结束，请先在平台核对完成状态并重新读取课程，不会直接沿用旧进度推进。')
   if(first.state==='unknown')throw new Error('无法确认播放器，请在工作台检查页面后重试。')
   await this.runtime.play(task);if(!this.current(task))return
   this.settlingUntil.set(task.id,this.clock()+12000)
  }catch(error){if(this.current(task))await this.attention(task,error instanceof Error?error.message:'启动失败，请检查平台页面。')}
  finally {this.transitioning.delete(task.platform);await this.next(task.platform)}
 }
 async pause(id: string, reason='由你暂停，点击恢复后会重新核对平台状态。'): Promise<void> {
  const t=this.find(id);if(terminalStatuses.includes(t.status))return
  if(t.status==='queued')throw new Error('待执行任务无需暂停，可以调整顺序或取消。')
  t.generation++;t.status='paused';t.playbackState='paused';t.reason=reason;this.enabled.delete(t.platform);this.last.delete(id);this.save(t)
  this.runtime.close(t.platform,t.id)
 }
 async pausePlatform(platform: PlatformId): Promise<void> { this.enabled.delete(platform);const t=this.repo.tasks().find(t=>t.platform===platform&&t.status==='running');if(t)await this.pause(t.id) }
 async resume(id: string): Promise<void> {
  const t=this.find(id);if(!['paused','attention','recoverable'].includes(t.status))throw new Error('只有暂停或待恢复任务可以恢复。')
  if(this.repo.tasks().some(x=>x.platform===t.platform&&x.id!==id&&!terminalStatuses.includes(x.status)&&x.status!=='queued'))throw new Error('同平台已有任务占用执行通道。')
  this.enabled.add(t.platform);await this.launch(t)
 }
 async cancel(id: string): Promise<void> {
  const t=this.find(id);if(terminalStatuses.includes(t.status))return
  t.generation++;t.status='cancelled';t.playbackState='paused';t.reason='已取消';this.forget(id);this.save(t);this.runtime.close(t.platform,t.id)
  await this.next(t.platform)
 }
 async cancelAccount(accountId: string): Promise<void> {
  const tasks=this.repo.tasks().filter(t=>t.accountId===accountId&&!terminalStatuses.includes(t.status))
  // Cancel the entire account's batch before any asynchronous queue advancement.
  // The platform's enabled/paused choice belongs to the user, not to this account.
  for(const t of tasks){t.generation++;t.status='cancelled';t.playbackState='paused';t.reason='账号已退出或删除';this.forget(t.id);this.save(t);this.runtime.close(t.platform,t.id)}
  for(const platform of new Set(tasks.map(t=>t.platform)))await this.next(platform)
 }
 reorder(id: string, direction: 'up'|'down'): void {
  const t=this.find(id);if(t.status!=='queued')throw new Error('只能调整待执行任务的顺序。')
  const all=this.repo.tasks().filter(x=>x.platform===t.platform&&x.status==='queued');const idx=all.findIndex(x=>x.id===id);const other=all[idx+(direction==='up'?-1:1)];if(!other)return
  const position=t.position;t.position=other.position;other.position=position;this.repo.saveTask(other);this.save(t)
 }
 private async attention(t: Task, reason: string): Promise<void> {
  if(!this.current(t))return
  t.status='attention';t.playbackState='unknown';t.reason=reason;t.generation++;this.last.delete(t.id);this.save(t)
  // Keep the page available for human handling, but synchronously stop audio, then stop media.
  try {await this.runtime.pause(t)} catch {this.runtime.close(t.platform,t.id)}
  this.notice('学习任务需要处理',reason)
 }
 async interrupt(reason: string): Promise<void> {
  this.enabled.clear();for(const t of this.repo.tasks().filter(t=>t.status==='running')){t.generation++;t.status='recoverable';t.playbackState='unknown';t.reason=reason;this.save(t);this.runtime.close(t.platform,t.id)}this.last.clear()
 }
 async tick(): Promise<void> {
  await Promise.all(platformIds.map(async platform=>{
   if(this.busy.has(platform)||this.transitioning.has(platform))return
   const t=this.repo.tasks().find(t=>t.platform===platform&&t.status==='running');if(!t)return
   this.busy.add(platform)
   try {const obs=await this.runtime.observe(t);if(!this.current(t))return;this.failures.delete(t.id);await this.accept(obs)}
   catch {if(this.current(t)){this.last.delete(t.id);const failures=(this.failures.get(t.id)??0)+1;this.failures.set(t.id,failures);if(failures>=3)await this.attention(t,'连续三次未能读取播放器状态，请检查网络或重新打开课程。')}}
   finally {this.busy.delete(platform)}
  }))
 }
 async accept(obs: Observation): Promise<void> {
  const t=this.repo.tasks().find(t=>t.id===obs.taskId&&t.accountId===obs.accountId&&t.generation===obs.generation&&t.status==='running')
  if(!t||t.chapters[t.chapterIndex]?.id!==obs.chapterId||!Number.isFinite(obs.observedAt)||obs.observedAt>this.clock()+1000||this.clock()-obs.observedAt>15000)return
  const previous=this.last.get(t.id);if(previous&&obs.observedAt<=previous.observedAt)return
  if(obs.issue){await this.attention(t,obs.issue);return}
  if(!Number.isFinite(obs.currentTime)||!Number.isFinite(obs.duration)||obs.currentTime<0||obs.duration<0){await this.attention(t,'播放器返回的时间不可靠，请人工检查。');return}
  if(obs.state==='ended'&&(obs.duration<=0||Math.abs(obs.currentTime-obs.duration)>1)){await this.attention(t,'播放结束状态与时长不一致，请人工核对，任务未自动推进。');return}
  if(previous?.state==='playing'&&['playing','ended'].includes(obs.state)){
   const wall=obs.observedAt-previous.observedAt;const media=(obs.currentTime-previous.currentTime)*1000
   // Polling gaps, seeking and stalled media are not counted as study time.
   if(wall>0&&wall<=10000&&media>0&&media<=wall*1.5+500)this.repo.addInterval({taskId:t.id,platform:t.platform,start:obs.observedAt-Math.min(wall,media),end:obs.observedAt})
  }
  this.last.set(t.id,obs);t.playbackState=obs.state;t.observedAt=obs.observedAt;t.currentTime=obs.currentTime;t.duration=obs.duration;t.platformCompletion=obs.completion
  if(obs.state==='ended'){
   t.playbackEnded=true;t.chapters[t.chapterIndex].completion=obs.completion;this.save(t)
   if(t.chapterIndex+1<t.chapters.length){
    t.chapterIndex++;t.currentTime=0;t.duration=0;t.playbackEnded=false;this.save(t);await this.launch(t)
   }else{
    t.status='finished';t.reason=t.chapters.every(c=>c.completion==='complete')?'所选章节已获平台确认。':'本地播放结束；部分章节的平台完成状态待确认。';t.platformCompletion=t.chapters.every(c=>c.completion==='complete')?'complete':'unknown';t.generation++;this.save(t);this.forget(t.id);this.runtime.close(t.platform,t.id);this.notice('本次播放任务已结束',t.reason);await this.next(t.platform)
   }
   }else if(obs.state==='playing') {
   this.save(t)
   if(!previous||obs.currentTime>previous.currentTime+0.02)this.uncertain.delete(t.id)
   else {const since=this.uncertain.get(t.id)??this.clock();this.uncertain.set(t.id,since);if(this.clock()-since>=20000)await this.attention(t,'播放时间持续没有前进，请检查网络或恢复窗口后继续。')}
  }
  else {
   this.save(t);if(this.clock()<(this.settlingUntil.get(t.id)??0))return
   const since=this.uncertain.get(t.id)??this.clock();this.uncertain.set(t.id,since)
   if(this.clock()-since>=12000)await this.attention(t,obs.state==='paused'?'播放已停止，可能需要用户点击播放或恢复窗口。':'持续无法确认播放，请检查网络、播放器或页面变化。')
  }
 }
}
