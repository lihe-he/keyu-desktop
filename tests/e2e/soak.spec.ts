import {test,expect,_electron as electron} from '@playwright/test'
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {Command,Snapshot} from '../../src/shared/contracts'
test('synthetic three-lane endurance and cancellation resource cleanup (NOT real-platform acceptance)',async()=>{
 await mkdir('.test-data',{recursive:true});await mkdir('reports',{recursive:true});const data=await mkdtemp(join(process.cwd(),'.test-data','soak-'));const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((p):p is [string,string]=>p[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;Object.assign(env,{CAMPUS_TEST_MODE:'1',CAMPUS_SOAK:'1',CAMPUS_USER_DATA:data});const app=await electron.launch({args:['.'],env});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.campus)
 const command=async(c:Command)=>{const r=await page.evaluate(c=>window.campus.command(c),c);if(!r.ok)throw Error(r.error);return r.data as any};const snapshot=async()=>page.evaluate(async()=>{const r=await window.campus.snapshot();if(!r.ok)throw Error(r.error);return r.data})
 const samples:any[]=[];const duration=Math.max(15000,Number(process.env.CAMPUS_SOAK_MS)||7200000);const started=Date.now();const version=(await snapshot()).version
 // Invalidate older success evidence before the run; a closed window must not
 // leave a previous version's passing report available to release packaging.
 const result={kind:'synthetic-fixture-NOT-real-platform',version,startedAt:new Date(started).toISOString()}
 await writeFile('reports/soak-result.json',JSON.stringify({...result,passed:false,status:'running'},null,2))
 try{
  for(const platform of ['chaoxing','icourse','zhihuishu'] as const){const a=await command({type:'account.add',platform,label:'稳定性测试'});await command({type:'account.open',accountId:a.id});await command({type:'courses.refresh',accountId:a.id});const c=(await snapshot()).courses.find(c=>c.accountId===a.id)!;await command({type:'course.chapters',courseId:c.id});await command({type:'task.add',courseId:c.id,chapterIds:[]});await command({type:'queue.start',platform})}
  while(Date.now()-started<duration){await new Promise(r=>setTimeout(r,5000));const s=await snapshot();expect(s.tasks.filter(t=>t.status==='running')).toHaveLength(3);expect(s.views).toHaveLength(3);const metrics=await app.evaluate(({webContents,app})=>({webContents:webContents.getAllWebContents().length,processes:app.getAppMetrics().map(m=>({type:m.type,workingSetSize:m.memory.workingSetSize}))}));expect(metrics.webContents).toBe(4);samples.push({at:Date.now(),stats:s.stats,...metrics});await command({type:'view.show',platform:['chaoxing','icourse','zhihuishu'][samples.length%3] as any,bounds:{x:240,y:180,width:720,height:450}});await command({type:'view.hide'})}
  for(const t of (await snapshot()).tasks)await command({type:'task.cancel',taskId:t.id});expect((await snapshot()).views).toHaveLength(0);await expect.poll(async()=>app.evaluate(({webContents})=>webContents.getAllWebContents().length)).toBe(1)
  await writeFile('reports/soak-result.json',JSON.stringify({...result,elapsedMs:Date.now()-started,passed:true,samples},null,2))
 }catch(error){await writeFile('reports/soak-result.json',JSON.stringify({...result,elapsedMs:Date.now()-started,passed:false,status:'failed',error:String(error),samples},null,2));throw error}finally{await app.close()}
})
