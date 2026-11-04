const { _electron: electron }=require('@playwright/test');
const fs=require('node:fs/promises'); const path=require('node:path'); const assert=require('node:assert/strict');
const { verificationProfile }=require('./verification-profile.cjs');
(async()=>{
 const env=Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined));delete env.ELECTRON_RUN_AS_NODE;
 env.CAMPUS_TEST_MODE='1';env.CAMPUS_USER_DATA=path.resolve('.test-data/should-not-be-used-by-package');
 const executablePath=path.resolve(process.argv[2]||'release/win-unpacked/CampusCourseDesktop.exe');
 const profile=verificationProfile();
 const app=await electron.launch({executablePath,args:profile.args,env,timeout:30000});
 let page,created=null,before;
 try{
  page=await app.firstWindow();await page.waitForFunction(()=>!!window.campus);
  await profile.verify(app);
  const command=async c=>{const r=await page.evaluate(c=>window.campus.command(c),c);assert.equal(r.ok,true,r.error);return r.data};
  const snap=async()=>{const r=await page.evaluate(()=>window.campus.snapshot());assert.equal(r.ok,true);return r.data};
  before=await snap();assert.equal(before.fixtureMode,false);assert.equal(before.platforms.every(p=>p.verification==='unverified'),true);
  const environment=await app.evaluate(({app})=>({packaged:app.isPackaged,userData:app.getPath('userData'),testHook:typeof globalThis.__campusTest,version:app.getVersion()}));
  assert.equal(environment.packaged,true);assert.equal(environment.testHook,'undefined');assert(!environment.userData.includes('should-not-be-used'));
  const emptyProduction=before.accounts.length===0&&before.courses.length===0&&before.tasks.length===0;
  await fs.mkdir('reports/screenshots',{recursive:true});await page.waitForSelector('h1');await page.screenshot({path:'reports/screenshots/09-packaged-home.png'});
  created=await command({type:'account.add',platform:'chaoxing',label:'安装校验临时账号'});
  await command({type:'settings.update',settings:{muteAll:!before.settings.muteAll}});
  const after=await snap();assert(after.accounts.some(a=>a.id===created.id));
  await command({type:'account.delete',accountId:created.id});created=null;
  await command({type:'settings.update',settings:{muteAll:before.settings.muteAll}});
  const final=await snap();assert.equal(final.accounts.length,before.accounts.length);
  // Closing a production window must hide to tray, not destroy the process.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  const hidden=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows()[0].isVisible());assert.equal(hidden,true);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  await fs.writeFile('reports/packaged-smoke.json',JSON.stringify({passed:true,at:new Date().toISOString(),executablePath,isolatedVerification:true,environment:{...environment,userData:"%TEMP%/CampusCourseDesktop-verification/[test-profile]"},emptyProduction,accountRoundtrip:true,trayClose:true,fixtureOverrideRejected:true},null,2));
  console.log('Packaged smoke checks passed.');
 }finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
