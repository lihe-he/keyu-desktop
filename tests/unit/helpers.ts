import { defaultSettings } from '../../src/shared/contracts'
import type { Account, Course, Task, Settings, Notice, StudyInterval, Chapter, Observation, PlatformId } from '../../src/shared/contracts'
import type { Repository } from '../../src/main/core/repository'
import type { PlaybackRuntime } from '../../src/main/core/engine'
const clone=<T>(value:T):T=>structuredClone(value)
export class MemoryRepository implements Repository {
 a:Account[]=[];c:Course[]=[];t:Task[]=[];n:Notice[]=[];i:StudyInterval[]=[];s:Settings={...defaultSettings};l:unknown[]=[]
 accounts(){return clone(this.a)} saveAccount(a:Account){this.a=this.a.filter(x=>x.id!==a.id).concat(clone(a))} removeAccount(id:string){this.a=this.a.filter(a=>a.id!==id);this.c=this.c.filter(c=>c.accountId!==id);this.t=this.t.filter(t=>t.accountId!==id);this.i=this.i.filter(i=>this.t.some(t=>t.id===i.taskId))}
 courses(id?:string){return clone(this.c.filter(c=>!id||c.accountId===id))} saveCourses(c:Course[]){for(const x of c)this.c=this.c.filter(y=>y.id!==x.id).concat(clone(x))}
 tasks(){return clone(this.t).sort((a,b)=>a.position-b.position||a.createdAt-b.createdAt)} saveTask(t:Task){this.t=this.t.filter(x=>x.id!==t.id).concat(clone(t))}
 settings(){return clone(this.s)} saveSettings(s:Settings){this.s=clone(s)} notices(){return clone(this.n)} saveNotice(n:Notice){this.n=this.n.filter(x=>x.id!==n.id).concat(clone(n))} readNotices(){this.n.forEach(n=>n.read=true)}
 addInterval(i:StudyInterval){this.i.push(clone(i))} intervals(from:number){return clone(this.i.filter(i=>i.end>from))} log(event:string,data?:Record<string,unknown>){this.l.push({event,data})} logs(){return clone(this.l)} clearHistory(){this.t=this.t.filter(t=>!['finished','cancelled'].includes(t.status));this.i=[];this.n=[];this.l=[]} close(){}
}
export const makeAccount=(platform:PlatformId='chaoxing',suffix='1'):Account=>({id:platform+'-'+suffix,platform,label:'测试账号',createdAt:1,loginStatus:'logged-in'})
export const makeCourse=(platform:PlatformId='chaoxing',suffix='1'):Course=>({id:platform+'-course-'+suffix,platform,accountId:platform+'-'+suffix,title:'测试课程',url:'https://www.chaoxing.com/course/'+suffix,updatedAt:1,completion:'unknown'})
export const makeChapters=(course:Course,count=2):Chapter[]=>Array.from({length:count},(_,i)=>({id:course.id+'-'+i,courseId:course.id,title:'视频'+i,url:course.url+'?chapter='+i,kind:'video',locked:false,completion:'unknown'}))
export class FakeRuntime implements PlaybackRuntime {
 slots=new Map<PlatformId,Task>();opens:Task[]=[];paused:string[]=[];closed:string[]=[];fail=false;issue:string|null=null;time=0;duration=10;state:Observation['state']='playing';completion:Observation['completion']='unknown';openGate:Promise<void>|null=null
 constructor(public clock:()=>number){}
 async open(t:Task){this.slots.set(t.platform,clone(t));this.opens.push(clone(t));if(this.openGate)await this.openGate}
 async play(_t:Task){} async pause(t:Task){this.paused.push(t.id)} close(p:PlatformId,id?:string){const t=this.slots.get(p);if(t&&(!id||t.id===id)){this.closed.push(t.id);this.slots.delete(p)}}
 async observe(t:Task):Promise<Observation>{if(this.fail)throw Error('network');return {taskId:t.id,accountId:t.accountId,chapterId:t.chapters[t.chapterIndex].id,generation:t.generation,observedAt:this.clock(),state:this.state,currentTime:this.time,duration:this.duration,completion:this.completion,issue:this.issue,url:t.chapters[t.chapterIndex].url}}
}
