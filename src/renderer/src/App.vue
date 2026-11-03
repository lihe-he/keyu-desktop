<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { BookOpen, LayoutDashboard, UsersRound, LibraryBig, PanelsTopLeft, ListOrdered, ChartNoAxesCombined, ShieldCheck, Bell, ArrowUpRight, X, Check, LoaderCircle } from 'lucide-vue-next'
import { useAppStore } from './store'
import Home from './pages/Home.vue';import Accounts from './pages/Accounts.vue';import Courses from './pages/Courses.vue';import Workbench from './pages/Workbench.vue';import Tasks from './pages/Tasks.vue';import Settings from './pages/Settings.vue';import Modal from './components/Modal.vue'
const store=useAppStore();const nav=[{id:'home',label:'学习首页',icon:LayoutDashboard},{id:'accounts',label:'账号管理',icon:UsersRound},{id:'courses',label:'我的课程',icon:LibraryBig},{id:'workbench',label:'学习工作台',icon:PanelsTopLeft},{id:'tasks',label:'任务中心',icon:ListOrdered},{id:'settings',label:'记录与设置',icon:ChartNoAxesCombined}]
onMounted(()=>void store.init());onUnmounted(()=>store.dispose())
</script>
<template>
 <div class="app-shell">
  <aside class="sidebar"><a class="brand" href="#" @click.prevent="store.navigate('home')"><span class="brand-icon"><BookOpen :size="25"/></span><span>网课助手<small>CAMPUS COMPANION</small></span></a>
   <div class="sidebar-label">我的学习空间</div><nav aria-label="主导航"><button v-for="item in nav" :key="item.id" :class="['nav-item',{active:store.page===item.id}]" @click="store.navigate(item.id)"><component :is="item.icon" :size="19"/><span>{{item.label}}</span><span v-if="item.id==='tasks'&&store.running.length" class="nav-count">{{store.running.length}}</span></button></nav>
   <div class="sidebar-bottom"><div class="privacy-note"><ShieldCheck :size="21"/><div><strong>只在你的电脑上</strong><p>账号与学习记录本地保存</p></div></div><div class="version"><span class="status-dot"></span> 本地试用版 <span>v{{store.data?.version??'0.1.0'}}</span></div></div>
  </aside>
  <main class="main-shell"><header class="topbar"><div class="breadcrumb">我的学习空间 <span>/</span> <strong>{{nav.find(n=>n.id===store.page)?.label}}</strong></div><div class="top-actions"><span class="local-pill"><span class="status-dot"></span> 本地运行</span><button class="notification-button" aria-label="查看学习提醒" @click="store.navigate('settings')"><Bell :size="19"/><i v-if="store.notices.some(n=>!n.read)"></i></button><div class="user-avatar">同学</div></div></header>
   <div v-if="store.data?.fixtureMode" class="fixture-banner">自动化测试模式 · 所有课程与平台页面均为明确标注的测试夹具，不代表真实平台已通过验证。</div>
   <div v-if="!store.data" class="loading-state"><LoaderCircle :size="30" class="spin"/><h2>正在打开你的学习空间</h2><p>读取本地数据，不会上传账号信息。</p></div>
   <div v-else class="page-scroll" :class="{'workbench-scroll':store.page==='workbench'}"><Home v-if="store.page==='home'"/><Accounts v-else-if="store.page==='accounts'"/><Courses v-else-if="store.page==='courses'"/><Workbench v-else-if="store.page==='workbench'"/><Tasks v-else-if="store.page==='tasks'"/><Settings v-else/></div>
  </main>
  <div v-if="store.message" class="toast" role="status"><Check :size="18"/>{{store.message}}<button aria-label="关闭提示" @click="store.message=''"><X :size="16"/></button></div>
  <Modal v-if="store.error" title="这一步需要你留意" @close="store.error=''"><div class="error-copy">{{store.error}}</div><p class="muted">未确认状态时，应用不会猜测进度或自动跳过平台要求。</p><div class="modal-actions"><button class="button primary" @click="store.error=''">知道了</button></div></Modal>
 </div>
</template>
