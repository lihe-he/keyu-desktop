"""Build an allowlisted source/evidence archive; never include local browser data."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import platform
import re
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8-sig'))['version']

def read_json(name):
    return json.loads((ROOT / 'reports' / name).read_text(encoding='utf-8-sig'))

def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def resolve_verified_installer(integrity, root=None, version=None):
    """Use the verified candidate, including when an older root installer exists."""
    root = (root or ROOT).resolve()
    version = version or VERSION
    assert integrity.get('passed') is True and integrity.get('version') == version, 'Current build identity verification is required.'
    raw = integrity.get('installerPath')
    assert isinstance(raw, str) and raw.startswith('release/'), 'Verified installer path is missing or not project relative.'
    parts = raw.split('/')
    assert all(part and part not in ('.', '..') and not re.search(r'[\\<>:"|?*\x00-\x1f]', part) for part in parts), 'Installer path is ambiguous.'
    assert not PurePosixPath(raw).is_absolute(), 'Installer must be project relative.'
    file = root.joinpath(*parts)
    assert file.name == f'CampusCourseDesktop-Setup-{version}-x64.exe', 'Installer filename differs from the current version.'
    assert file.is_file() and not file.is_symlink(), 'Verified installer is missing or is not a regular file.'
    real_file, real_release = file.resolve(), (root / 'release').resolve()
    assert real_file.is_relative_to(real_release) and real_file != real_release, 'Installer resolves outside project release outputs.'
    assert real_file == file, 'Installer must not follow a symlink or reparse point.'
    assert sha256(file) == integrity.get('installerSha256'), 'Verified installer changed; repeat identity checks.'
    return file


def bundle_outputs(installer, version):
    """Keep delivery files beside this candidate and refuse existing outputs."""
    directory = installer.parent
    outputs = [directory / f'CampusCourseDesktop-Source-{version}.zip',
               directory / 'manifest.json', directory / 'SHA256SUMS.txt', directory / '交付说明.md']
    assert all(not file.exists() and not file.is_symlink() for file in outputs), 'Delivery output already exists; do not overwrite prior artifacts.'
    return directory, outputs

def validate_desktop_report(report):
    """Require complete successful desktop results, not a fixed historical count."""
    assert isinstance(report, dict), 'Desktop report is missing.'
    stats = report.get('stats')
    assert isinstance(stats, dict), 'Desktop statistics are missing.'
    counts = {key: stats.get(key) for key in ('expected', 'unexpected', 'flaky', 'skipped')}
    assert all(type(value) is int and value >= 0 for value in counts.values()), 'Desktop statistics are invalid.'
    assert counts['expected'] > 0, 'Desktop report contains no successful tests.'
    assert all(counts[key] == 0 for key in ('unexpected', 'flaky', 'skipped')), 'Desktop tests failed, were flaky or were skipped.'
    assert report.get('errors') == [], 'Desktop report contains errors or is incomplete.'
    suites = report.get('suites')
    assert isinstance(suites, list) and suites, 'Desktop suites are missing.'
    seen_specs = set()
    seen_tests = set()

    def count_suite(suite):
        assert isinstance(suite, dict), 'Desktop suite is invalid.'
        specs, nested = suite.get('specs', []), suite.get('suites', [])
        assert isinstance(specs, list) and isinstance(nested, list), 'Desktop suite entries are missing.'
        count = 0
        for spec in specs:
            assert isinstance(spec, dict) and spec.get('ok') is True, 'Desktop specification did not pass.'
            identity = spec.get('id')
            assert isinstance(identity, str) and identity and identity not in seen_specs, 'Desktop specification identity is missing or duplicated.'
            seen_specs.add(identity)
            tests = spec.get('tests')
            assert isinstance(tests, list) and tests, 'Desktop test entries are missing.'
            for test in tests:
                assert isinstance(test, dict), 'Desktop test is invalid.'
                assert test.get('projectName') == 'desktop' and test.get('projectId') == 'desktop', 'Report contains tests from another project.'
                test_identity = (identity, test['projectId'])
                assert test_identity not in seen_tests, 'Desktop test entry is duplicated.'
                seen_tests.add(test_identity)
                assert test.get('expectedStatus') == 'passed' and test.get('status') == 'expected', 'Desktop test did not pass normally.'
                results = test.get('results')
                assert isinstance(results, list) and len(results) == 1, 'Desktop execution result is missing or retried.'
                result = results[0]
                assert isinstance(result, dict) and result.get('status') == 'passed', 'Desktop execution did not pass.'
                assert type(result.get('retry')) is int and result['retry'] == 0, 'Desktop execution was retried or is incomplete.'
                assert result.get('errors') == [] and result.get('error') is None, 'Desktop execution contains errors or is incomplete.'
                count += 1
        for child in nested:
            count += count_suite(child)
        assert count > 0, 'Desktop suite is empty.'
        return count

    actual = sum(count_suite(suite) for suite in suites)
    assert actual == counts['expected'], 'Desktop statistics do not match the execution results.'
    return actual


def main():
    unit, desktop, soak, packaged, install = [read_json(name) for name in (
        'unit-results.json', 'e2e-results.json', 'soak-result.json', 'packaged-smoke.json', 'install-smoke.json')]
    assert unit['numFailedTests'] == 0 and unit['numPassedTests'] > 0
    desktop_count = validate_desktop_report(desktop)
    assert soak['passed'] and packaged['passed'] and install['passed']
    assert soak['version'] == VERSION, 'Synthetic endurance report belongs to another version.'
    assert packaged['isolatedVerification'] and install['isolatedVerification'], 'Packaged checks must not use real account data.'
    public_entry = read_json('public-entry-smoke.json')
    assert public_entry['passed'] and public_entry['version'] == VERSION
    integrity = read_json('release-integrity.json')
    assert integrity['passed'] and integrity['version'] == VERSION
    assert packaged['environment']['version'] == VERSION and install['toVersion'] == VERSION
    installer = resolve_verified_installer(integrity)
    assert sha256(installer) == install['installerSha256'] == integrity['installerSha256'], 'Installer changed since install acceptance. Re-test before bundling.'
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
    for name in ('unit-results.json', 'e2e-results.json', 'soak-result.json', 'packaged-smoke.json', 'install-smoke.json', 'release-integrity.json', 'public-entry-smoke.json'):
        files.append(ROOT / 'reports' / name)
    for name in ('release-script-results.json', 'installer-input-selection.json'):
        report_file = ROOT / 'reports' / name
        if report_file.is_file():
            files.append(report_file)
    for screenshot in (ROOT / 'reports' / 'screenshots').glob('*.png'):
        if screenshot.name not in ('06-workbench.png', '06-workbench-native.png'):
            files.append(screenshot)

    delivery, outputs = bundle_outputs(installer, VERSION)
    source_archive, manifest_file, sums_file, guide_file = outputs
    with zipfile.ZipFile(source_archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(set(files)):
            relative = file.relative_to(ROOT)
            assert not file.is_symlink(), 'Do not follow source symlinks'
            assert not set(relative.parts) & {'.test-data', 'node_modules', '.cache', '__pycache__'}
            assert relative.parts[0] != 'release'
            assert file.suffix not in {'.sqlite3', '.db', '.pyc', '.log'}, 'Sensitive/runtime file excluded'
            archive.write(file, Path(f'campus-course-desktop-{VERSION}') / relative)
    with zipfile.ZipFile(source_archive) as archive:
        assert archive.testzip() is None
        entries = archive.namelist()
        assert any(n.endswith('/pnpm-lock.yaml') for n in entries)
        assert any(n.endswith('/src/main/index.ts') for n in entries)
        for file in sorted(set(files)):
            name = str(Path(f'campus-course-desktop-{VERSION}') / file.relative_to(ROOT)).replace('\\', '/')
            assert hashlib.sha256(archive.read(name)).hexdigest() == sha256(file), 'Source archive differs from project.'

    artifacts = [{'file': file.name, 'bytes': file.stat().st_size, 'sha256': sha256(file)} for file in (installer, source_archive)]
    manifest = {
        'version': VERSION, 'status': 'development-preview-NOT-real-platform-accepted',
        'artifactDirectory': delivery.relative_to(ROOT).as_posix(),
        'builtAt': datetime.now(timezone.utc).isoformat(), 'target': 'Windows 10/11 x64',
        'testedHost': platform.platform(), 'realPlatformAcceptance': {p: 'unverified' for p in ('chaoxing', 'icourse', 'zhihuishu')},
        'tests': {'unitPassed': unit['numPassedTests'], 'desktopPassed': desktop_count,
                  'syntheticSoakElapsedMs': soak['elapsedMs'], 'packagedSmoke': packaged['passed'],
                  'developerHostInstallReinstallUninstall': install['passed'], 'upgradeFrom': install.get('fromVersion'), 'upgradeTo': install.get('toVersion'), 'crossVersionUpgradePreservesData': install.get('crossVersionUpgradePreservesData', False),
                  'publicEntryCheckOnly': public_entry['passed'], 'authenticatedCourseAcceptance': 'not-performed', 'cleanWindowsAcceptance': 'not-performed', 'realPlatformTwoHourAcceptance': 'not-performed'},
        'sourceFiles': len(entries), 'buildIdentityVerified': integrity['passed'], 'lockedPackages': integrity['lockedPackageCount'], 'artifacts': artifacts,
    }
    with manifest_file.open('x', encoding='utf-8') as file:
        file.write(json.dumps(manifest, ensure_ascii=False, indent=2))
    with sums_file.open('x', encoding='utf-8') as file:
        file.write(''.join(f"{a['sha256']}  {a['file']}\n" for a in artifacts))
    guide = f'''# 网课助手 {VERSION} · 开发预览版

- 安装：双击 {installer.name}，按当前用户安装。未签名，请先核对来源及 SHA256SUMS.txt，不要关闭系统安全功能。
- 源码：解压 {source_archive.name}；内含代码、锁文件、测试、使用说明和兼容性报告，不含浏览器账号数据或 node_modules。
- 免安装：保留完整 {integrity.get('unpackedDirectory', 'release/win-unpacked')} 文件夹，运行其中 CampusCourseDesktop.exe。
- 自动检查：{unit['numPassedTests']} 项单元测试、{desktop_count} 项桌面流程通过；约 {soak['elapsedMs']/60000:.1f} 分钟合成媒体运行通过。
- 安装校验：本开发机安装、独立启动、同版本重装与卸载保留数据通过；跨版本升级是否实测：{install.get('crossVersionUpgradePreservesData', False)}（起止版本 {install.get('fromVersion')} → {install.get('toVersion')}）。不是干净 Windows 10/11 测试机验收。

**当前三个真实平台都未完成实课验收，不能认定为计划中的完整首版。**
需要用户在本机分别登录三个平台，各准备一门课程的连续两个可进入视频章节，继续登录、目录、播放、切章、完成状态及异常验证。不要把密码或验证码发到聊天里。

不自动答题、代考试、伪造进度或绕过平台限制；仅适合有人看护的小范围试用。详见源码 docs/使用说明.md、docs/测试报告.md、docs/真实平台兼容性报告.md。
'''
    with guide_file.open('x', encoding='utf-8') as file:
        file.write(guide)
    print(json.dumps({'archive': str(source_archive), 'artifactDirectory': str(delivery), 'files': len(entries), 'artifacts': artifacts}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
