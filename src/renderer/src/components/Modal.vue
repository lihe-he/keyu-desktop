<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useAppStore } from '../store'
defineProps<{ title: string; wide?: boolean }>();const emit=defineEmits<{close:[]}>();const store=useAppStore();const panel=ref<HTMLElement>();const previous=document.activeElement as HTMLElement|null
function key(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();emit('close')}if(event.key==='Tab'&&panel.value){const els=Array.from(panel.value.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]'));if(!els.length)return;const first=els[0],last=els[els.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}}
onMounted(()=>{store.modalDepth++;void window.campus.command({type:'view.hide'});document.addEventListener('keydown',key);panel.value?.querySelector<HTMLElement>('input,button')?.focus()})
onUnmounted(()=>{store.modalDepth=Math.max(0,store.modalDepth-1);document.removeEventListener('keydown',key);previous?.focus()})
</script>
<template><Teleport to="body"><div class="modal-backdrop" @click.self="emit('close')"><section ref="panel" class="modal" :class="{wide}" role="dialog" aria-modal="true" :aria-label="title"><header><h2>{{title}}</h2><button class="icon-button" aria-label="关闭弹窗" @click="emit('close')"><X :size="20"/></button></header><div class="modal-body"><slot/></div></section></div></Teleport></template>
