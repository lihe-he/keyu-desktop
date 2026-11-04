// Public entry reachability only. No sign-in, course access or credential collection.
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { verificationProfile } = require('./verification-profile.cjs');
const root = path.resolve(__dirname, '..');
const reportFile = path.join(root, 'reports/public-entry-smoke.json');
const report = { kind: 'real-public-entry-NOT-authenticated-course-acceptance', passed: false, startedAt: new Date().toISOString(), platforms: [] };
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; delete env.CAMPUS_TEST_MODE; delete env.CAMPUS_SOAK;
  await fs.mkdir(path.join(root, '.test-data'), { recursive: true });
  await fs.mkdir(path.join(root, 'reports'), { recursive: true });
  const packaged = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!packaged) env.CAMPUS_USER_DATA = await fs.mkdtemp(path.join(root, '.test-data/public-entry-'));
  else delete env.CAMPUS_USER_DATA;
  const profile = verificationProfile();
  const app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: profile.args } : { args: [root] }), env, timeout: 30000 });
  const created = [];
  let page;
  try {
    page = await app.firstWindow(); await page.waitForFunction(() => !!window.campus);
    if (packaged) await profile.verify(app);
    const cmd = c => page.evaluate(c => window.campus.command(c), c);
    const snapshot = () => page.evaluate(() => window.campus.snapshot());
    const before = await snapshot(); assert(before.ok && !before.data.fixtureMode);
    assert.equal(before.data.accounts.length, 0, 'Existing accounts found; refusing to mix this check with real login sessions.');
    report.version = before.data.version; report.packaged = Boolean(packaged); report.isolatedVerification = true;
    await app.evaluate(({ app }) => {
      globalThis.__entryLoadErrors = [];
      app.on('web-contents-created', (_event, wc) => {
        wc.on('did-fail-load', (_e, code, _description, _url, mainFrame) => {
          globalThis.__entryLoadErrors.push({ code, mainFrame });
        });
      });
    });
    for (const platform of ['chaoxing', 'icourse', 'zhihuishu']) {
      const added = await cmd({ type: 'account.add', platform, label: '官方入口检查临时账号' }); assert(added.ok);
      const account = added.data; created.push(account);
      const opened = await cmd({ type: 'account.open', accountId: account.id });
      await cmd({ type: 'view.show', platform, bounds: { x: 225, y: 205, width: 1040, height: 570 } });
      await new Promise(resolve => setTimeout(resolve, 5000));
      const current = await snapshot(); const info = current.data.views.find(v => v.accountId === account.id);
      // Snapshot URLs are redacted by production code. Match their origin only.
      const frames = info ? await app.evaluate(async ({ webContents }, origin) => {
        const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin + '/'));
        if (!wc) return [];
        const states = [];
        for (const frame of wc.mainFrame.framesInSubtree) {
          try {
            const url = new URL(frame.url); if (url.protocol !== 'https:') continue;
            const state = await frame.executeJavaScript(`(() => {
              const visible = el => {const box = el.getBoundingClientRect(), style = getComputedStyle(el); return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'};
              const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
              return {ready: document.readyState, hasLoginText: /登录|登入/.test(document.body?.innerText || ''),
                chaoxingHttpsReturn: location.origin === 'https://passport2.chaoxing.com' ? decodeURIComponent(document.querySelector('#refer')?.getAttribute('value') || '') === 'https://i.chaoxing.com/' : null,
                visiblePasswordInputs: inputs.filter(el => el.type === 'password').length,
                bridgeExposed: typeof window.campus !== 'undefined', nodeExposed: typeof window.require !== 'undefined',
                playingMedia: Array.from(document.querySelectorAll('video,audio')).filter(m => !m.paused && !m.ended).length};
            })()`);
            states.push({ origin: url.origin, ...state });
          } catch { states.push({ unreadableFrame: true }); }
        }
        return states;
      }, new URL(info.url).origin) : [];
      const login = await cmd({ type: 'account.check', accountId: account.id });
      const loadErrors = await app.evaluate(() => globalThis.__entryLoadErrors.splice(0));
      const row = { platform, openSucceeded: opened.ok, loginProbe: login.ok ? login.data : 'read-failed', frames, loadErrors };
      report.platforms.push(row); console.log(JSON.stringify(row));
      await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
      const removed = await cmd({ type: 'account.delete', accountId: account.id }); assert(removed.ok);
      assert(opened.ok, platform + ': entry command failed');
      assert(frames.some(frame => frame.ready === 'complete' && frame.hasLoginText), platform + ': login entry not visible');
      if(platform === 'chaoxing') assert(frames.some(frame => frame.chaoxingHttpsReturn === true), 'Official page did not retain the configured HTTPS login return.');
      assert(frames.every(frame => !frame.bridgeExposed && !frame.nodeExposed && !frame.playingMedia), 'Entry isolation or media policy failed');
      assert(!loadErrors.some(error => error.mainFrame), platform + ': main document failed to load');
    }
    assert.equal((await snapshot()).data.accounts.length, 0);
    report.passed = true; report.finishedAt = new Date().toISOString();
  } finally {
    if (page) for (const account of created) {
      await page.evaluate(c => window.campus.command(c), { type: 'account.delete', accountId: account.id }).catch(() => {});
    }
    await app.close();
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(String(error)); process.exitCode = 1; });
