import { it,expect,beforeAll } from 'vitest'
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require=createRequire(import.meta.url)
let result:any
beforeAll(()=>{
 const base=join(process.cwd(),'.test-data');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'store-'));mkdirSync(join(dir,'main'));mkdirSync(join(dir,'shared'))
 for(const [src,dest] of [['src/main/store.ts','main/store.cjs'],['src/shared/contracts.ts','shared/contracts.js']])writeFileSync(join(dir,dest),ts.transpileModule(readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)
 writeFileSync(join(dir,'run.cjs'),"const {Store}=require('./main/store.cjs');const Database=require('better-sqlite3');const file=require('node:path').join(__dirname,'sample.sqlite3');let store=new Store(file);const a={id:'a',platform:'chaoxing',label:'学生',createdAt:1,loginStatus:'unknown'},b={...a,id:'b'};store.saveAccount(a);store.saveAccount(b);const c={id:'c',accountId:'a',platform:'chaoxing',title:'课程',url:'https://i.chaoxing.com/course?id=1',completion:'unknown',updatedAt:1};store.saveCourses([c]);const t={id:'t',accountId:'a',platform:'chaoxing',courseId:'c',status:'finished',position:1,createdAt:1};store.saveTask(t);store.addInterval({taskId:'t',platform:'chaoxing',start:1,end:5});store.saveSettings({...store.settings(),muteAll:true});store.saveNotice({id:'n',createdAt:2,read:false,body:'test',title:'test',level:'info'});store.readNotices();let fk=false;try{store.saveCourses([{...c,id:'bad',accountId:'missing'}])}catch{fk=true}store.close();store=new Store(file);const out={reopen:{accounts:store.accounts().length,courses:store.courses().length,tasks:store.tasks().length,intervals:store.intervals(0).length,mute:store.settings().muteAll,read:store.notices()[0].read},fk};store.removeAccount('a');out.cascade={accounts:store.accounts().map(a=>a.id),courses:store.courses().length,tasks:store.tasks().length,intervals:store.intervals(0).length};store.saveTask({...t,id:'hold',accountId:'b',status:'paused'});store.saveTask({...t,id:'done',accountId:'b'});store.clearHistory();out.clear={tasks:store.tasks().map(t=>t.id),notices:store.notices().length,accounts:store.accounts().length};store.close();let db=new Database(file);out.version=db.pragma('user_version',{simple:true});db.pragma('user_version=99');db.close();try{new Store(file);out.forward=false}catch{out.forward=true}db=new Database(file);out.forwardPreserved=db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;db.close();console.log(JSON.stringify(out));")
 const child=spawnSync(require('electron'),[join(dir,'run.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:12000});if(child.status!==0)throw new Error(child.stderr||String(child.error));result=JSON.parse(child.stdout.trim())
})
it('migrates the SQLite schema to v1',()=>expect(result.version).toBe(1))
it('reopens persisted accounts courses tasks intervals settings and notices',()=>expect(result.reopen).toEqual({accounts:2,courses:1,tasks:1,intervals:1,mute:true,read:true}))
it('enforces account foreign keys',()=>expect(result.fk).toBe(true))
it('deleting one account cascades only its own records',()=>expect(result.cascade).toEqual({accounts:['b'],courses:0,tasks:0,intervals:0}))
it('clearing history preserves unfinished tasks and accounts',()=>expect(result.clear).toEqual({tasks:['hold'],notices:0,accounts:1}))
it('refuses a newer database version without destroying it',()=>{expect(result.forward).toBe(true);expect(result.forwardPreserved).toBe(1)})
