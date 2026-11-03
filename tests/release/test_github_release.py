"""Offline tests for release validation; no GitHub access or credential lookup."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('github_release', Path(__file__).parents[2] / 'scripts/github-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseValidation(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_root = release.ROOT
        release.ROOT = self.root = Path(self.directory.name)
        (self.root / 'release').mkdir()
        (self.root / 'package.json').write_text('{"version":"0.1.2"}', encoding='utf-8')
        self.entries = []
        for name in ('CampusCourseDesktop-Setup-0.1.2-x64.exe', 'CampusCourseDesktop-Source-0.1.2.zip'):
            data = b'explicit-test-fixture-not-an-installer'
            (self.root / 'release' / name).write_bytes(data)
            self.entries.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        self.manifest = {'version':'0.1.2', 'status':'development-preview-NOT-real-platform-accepted',
                         'buildIdentityVerified':True, 'artifacts':self.entries,
                         'realPlatformAcceptance':{p:'unverified' for p in ('chaoxing','icourse','zhihuishu')}}
        self.save()

    def tearDown(self):
        release.ROOT = self.original_root
        self.directory.cleanup()

    def save(self):
        (self.root / 'release/manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        (self.root / 'release/SHA256SUMS.txt').write_text(''.join(f"{e['sha256']}  {e['file']}\n" for e in self.entries), encoding='utf-8')

    def asset(self):
        file = self.root / 'release' / self.entries[0]['file']
        return file, {'name':file.name,'state':'uploaded','size':file.stat().st_size,'digest':'sha256:'+release.sha256(file)}

    def test_accepts_exact_artifact_set(self):
        version, _, files = release.artifacts()
        self.assertEqual(version, '0.1.2')
        self.assertEqual(len(files), 4)

    def test_rejects_tampered_file(self):
        (self.root / 'release' / self.entries[0]['file']).write_bytes(b'changed')
        with self.assertRaises(AssertionError): release.artifacts()

    def test_rejects_wrong_version(self):
        self.manifest['version'] = '0.1.0'; self.save()
        with self.assertRaises(AssertionError): release.artifacts()

    def test_rejects_path_outside_allowlist(self):
        self.entries[0]['file'] = '../../session.db'; self.save()
        with self.assertRaises(AssertionError): release.artifacts()

    def test_rejects_false_platform_acceptance(self):
        self.manifest['realPlatformAcceptance']['chaoxing'] = 'verified'; self.save()
        with self.assertRaises(AssertionError): release.artifacts()

    def test_rejects_changed_checksum_list(self):
        (self.root / 'release/SHA256SUMS.txt').write_text('wrong', encoding='utf-8')
        with self.assertRaises(AssertionError): release.artifacts()

    def test_validates_remote_digest_not_only_size(self):
        file, asset = self.asset()
        release.verify_asset(asset, file)
        asset['digest'] = 'sha256:' + '0' * 64
        with self.assertRaises(AssertionError): release.verify_asset(asset, file)

    def test_missing_digest_is_not_success(self):
        file, asset = self.asset(); del asset['digest']
        with self.assertRaises(AssertionError): release.verify_asset(asset, file)


if __name__ == '__main__':
    unittest.main()
