"""Publish verified preview artifacts to the configured GitHub repository.

Credentials stay in memory and are obtained through Git's credential helper.
Default is read-only --check. Never overwrite a release asset or force a ref.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = 'lihe-he/keyu-desktop'
ORIGIN = f'https://github.com/{REPOSITORY}.git'
API = 'https://api.github.com'


def git(*args):
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}
    result = subprocess.run(['git', *args], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError('Git operation failed: ' + ' '.join(args[:2]) + '; check repository access locally.')
    return result.stdout.decode('utf-8').strip()


def sha256(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward credentials to another host or follow unreviewed URLs.
        return None


class GitHub:
    def __init__(self):
        assert git('remote', 'get-url', 'origin') == ORIGIN, 'Unexpected remote; refusing publication.'
        env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}
        result = subprocess.run(['git', '-c', 'credential.interactive=never', 'credential', 'fill'],
                                cwd=ROOT, env=env, input=b'protocol=https\nhost=github.com\n\n',
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40)
        values = dict(line.split('=', 1) for line in result.stdout.decode('utf-8').splitlines() if '=' in line)
        self.token = values.get('password')
        if result.returncode or not self.token:
            raise RuntimeError('GitHub authentication unavailable. Sign in locally; never paste a token in chat.')
        proxy_result = subprocess.run(['git', 'config', '--get-urlmatch', 'http.proxy', ORIGIN], cwd=ROOT, capture_output=True)
        proxy = proxy_result.stdout.decode('utf-8').strip()
        handlers = [NoRedirect()]
        if proxy:
            handlers.append(urllib.request.ProxyHandler({'https': proxy}))
        self.opener = urllib.request.build_opener(*handlers)

    def call(self, method, path, body=None, file=None):
        url = path if path.startswith('https://') else API + path
        parsed = urllib.parse.urlsplit(url)
        assert parsed.scheme == 'https' and parsed.hostname in ('api.github.com', 'uploads.github.com')
        assert not parsed.username and not parsed.password and parsed.port in (None, 443)
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Keyu-Desktop-Release'}
        data = None
        if file:
            data = file.read_bytes()
            headers['Content-Type'] = 'application/octet-stream'
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(url, method=method, headers=headers, data=data)
        try:
            with self.opener.open(request, timeout=300 if file else 45) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            # Do not print request headers, arbitrary API responses, or credential data.
            if error.code == 404 and method == 'GET':
                return None
            raise RuntimeError(f'GitHub HTTP {error.code} during {method} {parsed.path}') from None


def artifacts():
    pkg = json.loads((ROOT / 'package.json').read_text(encoding='utf-8-sig'))
    manifest = json.loads((ROOT / 'release/manifest.json').read_text(encoding='utf-8-sig'))
    assert manifest['version'] == pkg['version']
    assert manifest['status'] == 'development-preview-NOT-real-platform-accepted'
    assert manifest['buildIdentityVerified']
    assert manifest['realPlatformAcceptance'] == {p: 'unverified' for p in ('chaoxing', 'icourse', 'zhihuishu')}, 'Review publication wording before promoting compatibility.'
    allowed = {f'CampusCourseDesktop-Setup-{pkg["version"]}-x64.exe', f'CampusCourseDesktop-Source-{pkg["version"]}.zip'}
    assert {entry['file'] for entry in manifest['artifacts']} == allowed
    files = []
    for entry in manifest['artifacts']:
        file = ROOT / 'release' / entry['file']
        assert file.is_file() and not file.is_symlink()
        assert file.stat().st_size == entry['bytes'] and sha256(file) == entry['sha256'], 'Artifact changed since verification.'
        files.append(file)
    sums = ''.join(f"{entry['sha256']}  {entry['file']}\n" for entry in manifest['artifacts'])
    assert (ROOT / 'release/SHA256SUMS.txt').read_text(encoding='utf-8') == sums, 'Checksum list differs from manifest.'
    files += [ROOT / 'release/SHA256SUMS.txt', ROOT / 'release/manifest.json']
    for file in files:
        assert file.is_file() and not file.is_symlink()
    return pkg['version'], manifest, files


def verify_asset(asset, file):
    assert asset['name'] == file.name and asset['state'] == 'uploaded'
    assert asset['size'] == file.stat().st_size
    assert asset.get('digest') == 'sha256:' + sha256(file), 'Remote asset digest differs or unavailable; leaving draft unpublished.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Read-only repository access check (default).')
    mode.add_argument('--publish', action='store_true', help='Upload verified files and publish as prerelease.')
    args = parser.parse_args()
    client = GitHub()
    repo = client.call('GET', f'/repos/{REPOSITORY}')
    assert repo and repo.get('full_name', '').lower() == REPOSITORY.lower(), 'Repository inaccessible.'
    assert repo.get('permissions', {}).get('push'), 'GitHub account lacks push permission.'
    print(json.dumps({'repository': repo['full_name'], 'visibility': repo['visibility'], 'defaultBranch': repo['default_branch'], 'canPush': True}))
    if not args.publish:
        return
    version, manifest, files = artifacts()
    assert not git('status', '--porcelain'), 'Commit all intended changes and keep a clean worktree before publication.'
    tag = 'v' + version
    head = git('rev-parse', 'HEAD')
    assert git('rev-parse', tag + '^{commit}') == head, 'Local release tag differs from current commit.'
    remote = git('ls-remote', 'origin', 'refs/tags/' + tag, 'refs/tags/' + tag + '^{}')
    hashes = [line.split('\t', 1)[0] for line in remote.splitlines()]
    assert head in hashes, 'Push the matching tag before publishing.'
    existing = client.call('GET', f'/repos/{REPOSITORY}/releases/tags/{tag}')
    if existing is None:
        # Draft releases may not resolve by tag. Reuse only our exact tag, never duplicate.
        for page in range(1, 11):
            batch = client.call('GET', f'/repos/{REPOSITORY}/releases?per_page=100&page={page}') or []
            existing = next((release for release in batch if release['tag_name'] == tag), None)
            if existing or len(batch) < 100:
                break
    body = (f'## 课屿 / 网课助手 {version} · 开发预览版\n\n'
            '保留原应用标识以便升级；仅用于有人看护的小范围试用。\n\n'
            f'- 源码提交：`{head}`\n'
            f'- 自动检查：{manifest["tests"]["unitPassed"]} 项单元测试，{manifest["tests"]["desktopPassed"]} 项桌面流程。\n'
            f'- 合成媒体运行：{manifest["tests"]["syntheticSoakElapsedMs"] / 60000:.1f} 分钟，不是真实平台两小时验收。\n'
            f'- 开发机升级：{manifest["tests"]["upgradeFrom"]} → {manifest["tests"]["upgradeTo"]}，保留数据。\n\n'
            '**学习通、中国大学 MOOC、智慧树均未完成真实课程验收；干净 Windows 10/11 安装与真实两小时验收仍未完成。**\n\n'
            '安装包未签名，请核对 SHA256SUMS.txt；不要关闭系统安全功能。不要上传密码、验证码、Cookie 或用户数据库。\n')
    release = existing or client.call('POST', f'/repos/{REPOSITORY}/releases',
                                     {'tag_name': tag, 'target_commitish': head, 'name': f'课屿 {version} · 开发预览版',
                                      'body': body, 'draft': True, 'prerelease': True, 'make_latest': 'false'})
    assert release['tag_name'] == tag and release['prerelease'], 'Existing release is not the expected preview.'
    release_id = release['id']
    assets = client.call('GET', f'/repos/{REPOSITORY}/releases/{release_id}/assets?per_page=100') or []
    for file in files:
        existing_asset = next((asset for asset in assets if asset['name'] == file.name), None)
        if existing_asset:
            verify_asset(existing_asset, file)
        else:
            assert release['draft'], 'Do not modify an already published release.'
            uploaded = client.call('POST', f'https://uploads.github.com/repos/{REPOSITORY}/releases/{release_id}/assets?name=' + urllib.parse.quote(file.name), file=file)
            verify_asset(uploaded, file)
        print('Verified uploaded asset: ' + file.name, flush=True)
    final_assets = client.call('GET', f'/repos/{REPOSITORY}/releases/{release_id}/assets?per_page=100')
    assert {asset['name'] for asset in final_assets} == {file.name for file in files}, 'Unexpected release assets.'
    for file in files:
        verify_asset(next(asset for asset in final_assets if asset['name'] == file.name), file)
    if release['draft']:
        release = client.call('PATCH', f'/repos/{REPOSITORY}/releases/{release_id}',
                              {'draft': False, 'prerelease': True, 'make_latest': 'false', 'body': body})
    assert release['prerelease'] and not release['draft']
    result = {'published': True, 'repository': REPOSITORY, 'version': version, 'commit': head, 'tag': tag,
              'url': release['html_url'], 'assets': [{'name': asset['name'], 'sha256': asset['digest'], 'bytes': asset['size']} for asset in final_assets]}
    (ROOT / 'reports/github-release.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, RuntimeError, subprocess.TimeoutExpired, urllib.error.URLError) as error:
        print('Release stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
