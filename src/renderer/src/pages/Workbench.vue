<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RefreshCw, ArrowLeft, Home, Volume2, VolumeX, PanelsTopLeft, LogIn, X, Pause, RotateCcw, ListOrdered, PanelRightClose, LockKeyhole } from 'lucide-vue-next'
import { useAppStore, stateLabels, clock } from '../store'
import { platforms } from '../../../shared/platforms'
import type { Chapter, Observation } from '../../../shared/contracts'
import PlatformMark from '../components/PlatformMark.vue'

const store = useAppStore()
const host = ref<HTMLElement>(), chosenAccount = ref(''), chaptersOpen = ref(true)
const info = computed(() => store.data?.views.find(v => v.platform === store.platform))
// Pausing deliberately releases the webpage. Keep its task and chapter context visible.
// A different account's browse page must never be labelled as this task's page.
const task = computed(() => info.value
 ? store.tasks.find(t => t.id === info.value?.taskId)
 : store.tasks.find(t => t.platform === store.platform && ['running', 'paused', 'attention', 'recoverable'].includes(t.status)))
const playerLabels: Record<Observation['state'], string> = {
 playing: '播放器正在播放', paused: '播放器已暂停', ended: '本地播放已结束', buffering: '播放器正在缓冲', unknown: '播放器状态待核对'
}
const playerLabel = computed(() => playerLabels[task.value?.playbackState ?? 'unknown'])
const chapterCompletion = (c: Chapter, index: number) => index === task.value?.chapterIndex ? task.value.platformCompletion : c.completion
const completionLabel = (c: Chapter, index: number) => chapterCompletion(c,index) === 'complete' ? '平台已确认完成' : chapterCompletion(c,index) === 'incomplete' ? '平台尚未确认完成' : '平台完成状态待确认'
function chapterLabel(index: number): string {
 const t = task.value
 if (!t) return ''
 if (index < t.chapterIndex || (index === t.chapterIndex && t.playbackEnded)) return '本地播放已结束'
 if (index === t.chapterIndex) return '当前章节'
 return t.chapters[index].kind === 'manual' ? '需要人工处理' : '等待顺序执行'
}
let observer: ResizeObserver | undefined, disposed = false, sizing = false, dirty = false
async function resize(): Promise<void> {
 dirty = true
 if (sizing || disposed) return
 sizing = true
 try {
  while (dirty && !disposed) {
   dirty = false
   await nextTick()
   if (disposed) break
   if (store.modalOpen || store.error) { await window.campus.command({ type: 'view.hide' }); continue }
   if (!host.value) continue
   const b = host.value.getBoundingClientRect()
   if (b.width < 1 || b.height < 1) continue
   await window.campus.command({ type: 'view.show', platform: store.platform, bounds: { x: Math.round(b.x), y: Math.round(b.y), width: Math.floor(b.width), height: Math.floor(b.height) } })
  }
 } catch { if (!disposed) store.error = '平台页面显示未能更新，请切换页面后重试。' }
 finally { sizing = false }
}
async function open(): Promise<void> {
 const a = store.accounts.find(a => a.id === chosenAccount.value)
 if (!a) return
 await store.run({ type: 'account.open', accountId: a.id })
 void resize()
}
watch(() => [store.platform, store.modalOpen, store.error, info.value?.accountId, info.value?.taskId, chaptersOpen.value], () => void resize())
onMounted(() => { observer = new ResizeObserver(() => void resize()); if (host.value) observer.observe(host.value); void resize() })
onUnmounted(() => { disposed = true; observer?.disconnect(); void window.campus.command({ type: 'view.hide' }) })
</script>

<template>
 <div class="workbench-page">
  <div class="workbench-heading">
   <div><h1>学习工作台</h1><p class="subtitle">平台原始页面 · 登录与人工处理都在这里完成</p></div>
   <button class="button compact" @click="store.run({type:'settings.update',settings:{muteAll:!store.data?.settings.muteAll}})">
    <VolumeX v-if="store.data?.settings.muteAll" :size="16"/><Volume2 v-else :size="16"/>
    {{ store.data?.settings.muteAll ? '取消全部静音' : '全部静音' }}
   </button>
  </div>
  <div class="workbench-tabs">
   <button v-for="p in platforms" :key="p.id" :class="{active:store.platform===p.id}" @click="store.platform=p.id">
    <PlatformMark :platform="p.id" small/>{{ p.name }}<span v-if="store.running.some(t=>t.platform===p.id)" class="status-dot"></span>
   </button>
  </div>
  <div class="browser-toolbar">
   <div class="button-group">
    <button class="icon-button" aria-label="平台页面后退" :disabled="!info||info.mode==='task'" @click="store.run({type:'view.navigate',platform:store.platform,action:'back'})"><ArrowLeft :size="17"/></button>
    <button class="icon-button" aria-label="刷新平台页面" :disabled="!info||info.mode==='task'" @click="store.run({type:'view.navigate',platform:store.platform,action:'reload'})"><RefreshCw :size="16"/></button>
    <button class="icon-button" aria-label="打开我的课程入口" :disabled="!info||info.mode==='task'" @click="store.run({type:'view.navigate',platform:store.platform,action:'home'})"><Home :size="17"/></button>
   </div>
   <div class="address-pill">{{ info ? store.accountLabel(info.accountId)+' · '+(info.mode==='task'?'任务页面':'登录 / 浏览模式') : task ? store.accountLabel(task.accountId)+' · 任务页面已释放' : '尚未打开平台页面' }}</div>
   <button class="icon-button" aria-label="让当前平台发声" :disabled="!info" :class="{selected:store.data?.settings.audiblePlatform===store.platform&&!store.data?.settings.muteAll}" @click="store.run({type:'settings.update',settings:{audiblePlatform:store.platform,muteAll:false}})"><Volume2 :size="17"/></button>
   <button class="icon-button" aria-label="关闭平台页面" :disabled="!info||task?.status==='running'" @click="store.run({type:'view.close',platform:store.platform})"><X :size="17"/></button>
  </div>
  <div class="workbench-status">
   <span v-if="task" :class="['badge',task.status==='running'?'green':'amber']">{{ stateLabels[task.status] }}</span>
   <span>{{ task ? (task.reason||'只按实际观察的播放状态推进，平台完成状态单独核对。') : '浏览模式不运行学习任务。登录后，请从“我的课程”读取课程并加入队列。' }}</span>
  </div>
  <div v-if="task" class="workbench-task-strip" data-testid="workbench-task-controls">
   <div class="workbench-current"><strong :title="task.chapters[task.chapterIndex]?.title">{{ task.chapters[task.chapterIndex]?.title }}</strong><span data-testid="player-observation">{{ playerLabel }} · {{ clock(task.currentTime) }} / {{ clock(task.duration) }}</span></div>
   <button v-if="task.status==='running'" class="button compact" aria-label="在工作台暂停任务" :disabled="!!store.busy" @click="store.run({type:'task.pause',taskId:task.id})"><Pause :size="15"/>暂停</button>
   <button v-else-if="['paused','attention','recoverable'].includes(task.status)" class="button primary-soft compact" aria-label="在工作台确认恢复" :disabled="!!store.busy" @click="store.run({type:'task.resume',taskId:task.id})"><RotateCcw :size="15"/>确认恢复</button>
   <button class="button compact" :aria-expanded="chaptersOpen" aria-controls="workbench-chapters" @click="chaptersOpen=!chaptersOpen"><PanelRightClose v-if="chaptersOpen" :size="15"/><ListOrdered v-else :size="15"/>{{ chaptersOpen ? '收起章节' : '展开章节' }}</button>
  </div>
  <div class="workbench-content">
   <div ref="host" class="browser-host" data-testid="browser-host">
    <div v-if="!info && task" class="browser-empty"><Pause :size="38"/><h2>任务已保留，页面已释放</h2><p>点击上方“确认恢复”，重新核对账号、章节和播放器。<br/>不会根据旧记录直接标记完成。</p></div>
    <div v-else-if="!info" class="browser-empty">
     <PanelsTopLeft :size="42"/><h2>在这里打开你的课程平台</h2><p>账号密码直接输入平台原页，应用不会代为保存。</p>
     <select v-model="chosenAccount" aria-label="选择工作台账号"><option value="">选择一个本地账号</option><option v-for="a in store.accounts.filter(a=>a.platform===store.platform)" :key="a.id" :value="a.id">{{ a.label }}</option></select>
     <button class="button primary" :disabled="!chosenAccount||!!store.busy" @click="open"><LogIn :size="16"/>打开平台登录</button><button class="text-button" @click="store.navigate('accounts')">还没有账号？去添加</button>
    </div>
   </div>
   <aside v-if="task && chaptersOpen" id="workbench-chapters" class="workbench-chapters" aria-label="当前任务章节列表">
    <header><h2>本次学习章节 <span>{{ task.chapterIndex+1 }} / {{ task.chapters.length }}</span></h2><p>{{ store.accountLabel(task.accountId) }}</p></header>
    <ol>
     <li v-for="(chapter,index) in task.chapters" :key="chapter.id" :aria-current="index===task.chapterIndex?'step':undefined" :class="{current:index===task.chapterIndex}">
      <span class="chapter-number">{{ index+1 }}</span><div><strong>{{ chapter.title }}</strong><p>{{ chapterLabel(index) }}</p><p :class="{'chapter-confirmed':chapterCompletion(chapter,index)==='complete'}">{{ completionLabel(chapter,index) }}</p><small v-if="chapter.locked"><LockKeyhole :size="11"/>上次读取未解锁，进入前重新核对</small></div>
     </li>
    </ol>
    <footer>顺序执行，不直接跳章。遇到答题、作业或解锁要求时暂停，由你在原页处理。</footer>
   </aside>
  </div>
  <div class="browser-footnote">适配状态：待真实课程验证。出现验证码、身份验证或答题要求时，请自行处理；应用不会绕过。</div>
 </div>
</template>
