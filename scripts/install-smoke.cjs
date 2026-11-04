// Developer-host acceptance only. Never touches an existing installation or deletes app data.
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verificationProfile } = require('./verification-profile.cjs');
const profile = verificationProfile();
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const installer = path.join(root, 'release', `CampusCourseDesktop-Setup-${version}-x64.exe`);
const initialInstaller = process.argv[2] ? path.resolve(process.argv[2]) : installer;
const target = path.join(root, '.test-data', 'install-' + Date.now());
const exe = path.join(target, 'CampusCourseDesktop.exe');
const report = { kind: 'developer-host-NOT-clean-Windows-acceptance', at: new Date().toISOString(), passed: false };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function installations() {
 const script = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $items=@(); foreach($root in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')){foreach($key in Get-ChildItem -LiteralPath $root){$p=Get-ItemProperty -LiteralPath $key.PSPath;if($p.DisplayName -like '*网课助手*' -or $p.InstallLocation -like '*CampusCourseDesktop*'){$items+=@{name=$p.DisplayName;location=$p.InstallLocation}}}};ConvertTo-Json -InputObject @($items) -Compress";
 const encoded = Buffer.from(script, 'utf16le').toString('base64');
 return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, '').trim());
}
async function run(file, args) {
 await new Promise((resolve, reject) => {
  const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(() => reject(Error('Installer timed out; inspect manually. No process/data forcibly removed.')), 180000);
  child.on('error', e => { clearTimeout(timer); reject(e); });
  child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Installer exit code ' + code)); });
 });
}
async function inApp(work) {
 const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
 delete env.ELECTRON_RUN_AS_NODE; delete env.CAMPUS_TEST_MODE; delete env.CAMPUS_USER_DATA;
 const app = await electron.launch({ executablePath: exe, args: profile.args, env, timeout: 30000 });
 try {
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.campus);
  await profile.verify(app);
  const command = async c => { const r = await page.evaluate(c => window.campus.command(c), c); assert.equal(r.ok, true, r.error); return r.data; };
  const snapshot = async () => { const r = await page.evaluate(() => window.campus.snapshot()); assert(r.ok); return r.data; };
  return await work({ app, command, snapshot });
 } finally { await app.close(); }
}
(async () => {
 assert.equal(process.platform, 'win32');
 // NSIS can close same-named portable processes too. Never interrupt a student's
 // running window even when no installed version is registered.
 const running = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Process -Name CampusCourseDesktop -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', windowsHide: true }).trim());
 assert.equal(running, 0, 'A course assistant is running. Exit it from the tray before installation verification; no process was stopped.');
 assert.equal(installations().length, 0, 'An existing installation was found; refusing to alter it.');
 assert.equal(await exists(target), false, 'Target must be new.');
 assert(path.relative(path.join(root, '.test-data'), target).startsWith('install-'));
 report.installerSha256 = crypto.createHash('sha256').update(await fs.readFile(installer)).digest('hex');
 await run(initialInstaller, ['/S', '/D=' + target]);
 assert(await exists(exe), 'Installed executable missing');
 report.installed = true;
 let created, mute, dataFile;
 await inApp(async ({ app, command, snapshot }) => {
  const before = await snapshot(); mute = before.settings.muteAll; report.fromVersion = before.version;
  assert.equal(before.fixtureMode, false);
  created = await command({ type: 'account.add', platform: 'chaoxing', label: '重装校验临时账号' });
  await command({ type: 'settings.update', settings: { muteAll: !mute } });
  const data = await app.evaluate(({ app }) => app.getPath('userData')); dataFile = path.join(data, 'campus.sqlite3');
 });
 report.installedLaunch = true;
 await run(installer, ['/S', '/D=' + target]);
 await inApp(async ({ command, snapshot }) => {
  const state = await snapshot();
  assert(state.accounts.some(a => a.id === created.id), 'Reinstall lost account metadata');
  assert.equal(state.settings.muteAll, !mute, 'Reinstall lost settings');
  report.toVersion = state.version; assert.equal(state.version, version);
 });
 report.crossVersionUpgradePreservesData = report.fromVersion !== report.toVersion;
 // A second run of the new installer also checks same-version reinstall.
 await run(installer, ['/S', '/D=' + target]);
 await inApp(async ({ command, snapshot }) => {
  const state = await snapshot(); assert(state.accounts.some(a => a.id === created.id)); assert.equal(state.settings.muteAll, !mute);
  await command({ type: 'account.delete', accountId: created.id });
  await command({ type: 'settings.update', settings: { muteAll: mute } });
 });
 report.sameVersionReinstallPreservesData = true;
 const uninstaller = (await fs.readdir(target)).find(n => /^Uninstall.*\.exe$/i.test(n));
 assert(uninstaller, 'Uninstaller missing');
 const resolvedUninstaller = path.resolve(target, uninstaller);
 assert.equal(path.dirname(resolvedUninstaller), path.resolve(target), 'Unsafe uninstall target');
 assert.equal(installations().length, 1, 'Unexpected registered installation count');
 await run(resolvedUninstaller, ['/S']);
 // NSIS may finish in a child process. Removing the executable is not the last
 // step: wait for both file removal and registry cleanup before judging success.
 const uninstallStarted = Date.now();
 while (Date.now() - uninstallStarted < 30000) {
  if (!await exists(exe) && installations().length === 0) break;
  await delay(500);
 }
 report.uninstallSettlementMs = Date.now() - uninstallStarted;
 assert.equal(await exists(exe), false, 'Uninstall did not remove test executable');
 assert.equal(installations().length, 0, 'Uninstall registration remains');
 assert(await exists(dataFile), 'Uninstall unexpectedly removed app data');
 report.uninstalled = true; report.uninstallPreservesData = true; report.isolatedVerification = true; report.passed = true;
 await fs.writeFile(path.join(root, 'reports/install-smoke.json'), JSON.stringify(report, null, 2));
 console.log('Install, installed launch, same-version reinstall and uninstall checks passed. Isolated data preserved. Cross-version upgrade tested: ' + report.crossVersionUpgradePreservesData);
})().catch(async error => {
 report.error = String(error); await fs.writeFile(path.join(root, 'reports/install-smoke.json'), JSON.stringify(report, null, 2));
 console.error(error); process.exitCode = 1;
});
