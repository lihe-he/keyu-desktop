"""Build an allowlisted source/evidence archive; never include local browser data."""
from pathlib import Path
import hashlib
import json
import platform
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
RELEASE = ROOT / 'release'
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8-sig'))['version']
INSTALLER = RELEASE / f'CampusCourseDesktop-Setup-{VERSION}-x64.exe'
ARCHIVE = RELEASE / f'CampusCourseDesktop-Source-{VERSION}.zip'

def read_json(name):
    return json.loads((ROOT / 'reports' / name).read_text(encoding='utf-8-sig'))

def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

unit, desktop, soak, packaged, install = [read_json(name) for name in (
    'unit-results.json', 'e2e-results.json', 'soak-result.json', 'packaged-smoke.json', 'install-smoke.json')]
assert unit['numFailedTests'] == 0 and unit['numPassedTests'] > 0
assert desktop['stats']['unexpected'] == 0 and desktop['stats']['expected'] == 5
assert soak['passed'] and packaged['passed'] and install['passed']
integrity = read_json('release-integrity.json')
assert integrity['passed'] and integrity['version'] == VERSION
assert packaged['environment']['version'] == VERSION and install['toVersion'] == VERSION
assert sha256(INSTALLER) == install['installerSha256'] == integrity['installerSha256'], 'Installer changed since install acceptance. Re-test before bundling.'
assert sha256(ROOT / 'pnpm-lock.yaml') == integrity['lockSha256'], 'Lock changed since delivery verification.'
for relative, expected in integrity['outputHashes'].items():
    assert sha256(ROOT / relative) == expected, 'Compiled output changed since package verification.'

files = []
for directory in ('src', 'tests', 'scripts', 'resources', 'docs'):
    files.extend(p for p in (ROOT / directory).rglob('*') if p.is_file())
for name in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'electron-builder.yml',
             'electron.vite.config.ts', 'playwright.config.ts', 'tsconfig.json', 'vitest.config.ts',
             '.gitignore', '.gitattributes', '.npmrc', 'README.md', 'PRODUCT_PLAN.md', 'LICENSE', 'AGENTS.md'):
    files.append(ROOT / name)
for name in ('unit-results.json', 'e2e-results.json', 'soak-result.json', 'packaged-smoke.json', 'install-smoke.json', 'release-integrity.json'):
    files.append(ROOT / 'reports' / name)
for screenshot in (ROOT / 'reports' / 'screenshots').glob('*.png'):
    if screenshot.name not in ('06-workbench.png', '06-workbench-native.png'):
        files.append(screenshot)

RELEASE.mkdir(exist_ok=True)
with zipfile.ZipFile(ARCHIVE, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(set(files)):
        relative = file.relative_to(ROOT)
        assert not file.is_symlink(), 'Do not follow source symlinks'
        assert not set(relative.parts) & {'.test-data', 'node_modules', '.cache', '__pycache__'}
        assert relative.parts[0] != 'release'
        assert file.suffix not in {'.sqlite3', '.db', '.pyc', '.log'}, 'Sensitive/runtime file excluded'
        archive.write(file, Path(f'campus-course-desktop-{VERSION}') / relative)
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None
    entries = archive.namelist()
    assert any(n.endswith('/pnpm-lock.yaml') for n in entries)
    assert any(n.endswith('/src/main/index.ts') for n in entries)
    for file in sorted(set(files)):
        name = str(Path(f'campus-course-desktop-{VERSION}') / file.relative_to(ROOT)).replace('\\', '/')
        assert hashlib.sha256(archive.read(name)).hexdigest() == sha256(file), 'Source archive differs from project.'

artifacts = [{'file': file.name, 'bytes': file.stat().st_size, 'sha256': sha256(file)} for file in (INSTALLER, ARCHIVE)]
manifest = {
    'version': VERSION, 'status': 'development-preview-NOT-real-platform-accepted',
    'builtAt': datetime.now(timezone.utc).isoformat(), 'target': 'Windows 10/11 x64',
    'testedHost': platform.platform(), 'realPlatformAcceptance': {p: 'unverified' for p in ('chaoxing', 'icourse', 'zhihuishu')},
    'tests': {'unitPassed': unit['numPassedTests'], 'desktopPassed': desktop['stats']['expected'],
              'syntheticSoakElapsedMs': soak['elapsedMs'], 'packagedSmoke': packaged['passed'],
              'developerHostInstallReinstallUninstall': install['passed'], 'upgradeFrom': install.get('fromVersion'), 'upgradeTo': install.get('toVersion'), 'crossVersionUpgradePreservesData': install.get('crossVersionUpgradePreservesData', False),
              'cleanWindowsAcceptance': 'not-performed', 'realPlatformTwoHourAcceptance': 'not-performed'},
    'sourceFiles': len(entries), 'buildIdentityVerified': integrity['passed'], 'lockedPackages': integrity['lockedPackageCount'], 'artifacts': artifacts,
}
(RELEASE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
(RELEASE / 'SHA256SUMS.txt').write_text(''.join(f"{a['sha256']}  {a['file']}\n" for a in artifacts), encoding='utf-8')
(RELEASE / '交付说明.md').write_text(f'''# 网课助手 {VERSION} · 开发预览版

- 安装：双击 {INSTALLER.name}，按当前用户安装。未签名，请先核对来源及 SHA256SUMS.txt，不要关闭系统安全功能。
- 源码：解压 {ARCHIVE.name}；内含代码、锁文件、测试、使用说明和兼容性报告，不含浏览器账号数据或 node_modules。
- 免安装：保留完整 win-unpacked 文件夹，运行其中 CampusCourseDesktop.exe。
- 自动检查：{unit['numPassedTests']} 项单元测试、{desktop['stats']['expected']} 项桌面流程通过；约 {soak['elapsedMs']/60000:.1f} 分钟合成媒体运行通过。
- 安装校验：本开发机安装、独立启动、升级（{install.get('fromVersion')} → {install.get('toVersion')}）及同版本重装保留数据、卸载保留数据通过；不是干净 Windows 10/11 测试机验收。

**当前三个真实平台都未完成实课验收，不能认定为计划中的完整首版。**
需要用户在本机分别登录三个平台，各准备一门课程的连续两个可进入视频章节，继续登录、目录、播放、切章、完成状态及异常验证。不要把密码或验证码发到聊天里。

不自动答题、代考试、伪造进度或绕过平台限制；仅适合有人看护的小范围试用。详见源码 docs/使用说明.md、docs/测试报告.md、docs/真实平台兼容性报告.md。
''', encoding='utf-8')
print(json.dumps({'archive': str(ARCHIVE), 'files': len(entries), 'artifacts': artifacts}, ensure_ascii=False, indent=2))
