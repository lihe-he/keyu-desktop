import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Snapshot, Command, PlatformId, Task } from '../../shared/contracts'
export const useAppStore=defineStore('app',()=>{
 const data=ref<Snapshot|null>(null),page=ref('home'),platform=ref<PlatformId>('chaoxing'),busy=ref(0),error=ref(''),message=ref(''),modalDepth=ref(0),modalOpen=computed(()=>modalDepth.value>0)
 function acceptSnapshot(s:Snapshot){if(!data.value||s.sequence>data.value.sequence)data.value=s}
 let dispose:(()=>void)|null=null;let messageTimer:ReturnType<typeof setTimeout>|undefined
 const accounts=computed(()=>data.value?.accounts??[]),courses=computed(()=>data.value?.courses??[]),tasks=computed(()=>data.value?.tasks??[]),notices=computed(()=>data.value?.notices??[])
 const running=computed(()=>tasks.value.filter(t=>t.status==='running'))
 function toast(value:string){message.value=value;if(messageTimer)clearTimeout(messageTimer);messageTimer=setTimeout(()=>message.value='',4500)}
 async function init(){if(!window.campus){error.value='桌面连接未建立，请通过已安装的网课助手打开，而不是直接用浏览器打开页面。';return}const result=await window.campus.snapshot();if(result.ok)acceptSnapshot(result.data);else error.value=result.error;dispose=window.campus.onSnapshot(acceptSnapshot)}
 async function run<T=unknown>(command:Command,success?:string):Promise<T|undefined>{busy.value++;try{const r=await window.campus.command<T>(JSON.parse(JSON.stringify(command)) as Command);if(!r.ok){error.value=r.error;return undefined}if(success)toast(success);const s=await window.campus.snapshot();if(s.ok)acceptSnapshot(s.data);return r.data}catch{error.value='应用暂时未响应，请稍后重试。';return undefined}finally{busy.value--}}
 function navigate(next:string){if(next!=='workbench')void window.campus?.command({type:'view.hide'});page.value=next}
 function workbench(p:PlatformId){platform.value=p;page.value='workbench'}
 const accountLabel=(id:string)=>accounts.value.find(a=>a.id===id)?.label??'已删除账号'
 const progress=(task:Task)=>task.duration?Math.min(100,Math.max(0,task.currentTime/task.duration*100)):0
 return {data,page,platform,busy,error,message,modalOpen,modalDepth,accounts,courses,tasks,notices,running,init,run,navigate,workbench,accountLabel,progress,toast,dispose:()=>dispose?.()}
})
export const stateLabels:Record<string,string>={queued:'待执行',running:'执行中',paused:'已暂停',attention:'需要处理',recoverable:'待确认恢复',finished:'本地播放结束',cancelled:'已取消'}
export const loginLabels:Record<string,string>={unknown:'登录状态待确认','logged-in':'已识别登录','logged-out':'未登录',attention:'需要验证'}
export function duration(ms:number):string{const min=Math.floor(ms/60000);return min>=60?Math.floor(min/60)+' 小时 '+min%60+' 分钟':min+' 分钟'}
export function clock(seconds:number):string{if(!Number.isFinite(seconds))return '00:00';return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(Math.floor(seconds%60)).padStart(2,'0')}
export function dateLabel(timestamp:number):string{return new Date(timestamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
