// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest'
import {setActivePinia,createPinia} from 'pinia'
import {reactive} from 'vue'
import {useAppStore} from '../../src/renderer/src/store'
import {defaultSettings,type Snapshot} from '../../src/shared/contracts'
let listener:(s:Snapshot)=>void
const snapshot=(sequence:number):Snapshot=>({sequence,accounts:[],courses:[],tasks:[],notices:[],settings:{...defaultSettings},platforms:[],views:[],stats:{playbackMs:0,elapsedMs:0,todayFinished:0},version:'0.1.0',fixtureMode:true,lifecycle:'ready'})
beforeEach(()=>{setActivePinia(createPinia());window.campus={snapshot:vi.fn(async()=>({ok:true as const,data:snapshot(1)})),command:vi.fn(async()=>({ok:true as const,data:null as any})),onSnapshot:vi.fn(fn=>{listener=fn;return ()=>{}})}})
it('ignores old snapshots arriving after a newer response',async()=>{const store=useAppStore();await store.init();listener(snapshot(5));listener(snapshot(3));expect(store.data?.sequence).toBe(5);store.dispose()})
it('sends cloneable plain parameters instead of Vue proxies',async()=>{const store=useAppStore();await store.init();const selected=reactive(['chapter-1','chapter-2']);await store.run({type:'task.add',courseId:'course-1',chapterIds:selected});const sent=vi.mocked(window.campus.command).mock.calls[0][0];expect(()=>structuredClone(sent)).not.toThrow();expect(sent).toEqual({type:'task.add',courseId:'course-1',chapterIds:['chapter-1','chapter-2']});store.dispose()})
it('keeps platform views suppressed while any modal remains open',()=>{const store=useAppStore();store.modalDepth=2;expect(store.modalOpen).toBe(true);store.modalDepth--;expect(store.modalOpen).toBe(true);store.modalDepth--;expect(store.modalOpen).toBe(false)})
