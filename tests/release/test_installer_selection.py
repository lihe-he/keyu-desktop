"""Read-only candidate selection tests; fixture bytes are never executed."""
import hashlib
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from test_source_bundle import desktop_report

PROJECT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location('source_bundle_selection', PROJECT / 'scripts/source-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
NODE_CODE = r'''
const fs = require('node:fs');
const inputs = require(process.argv[1]);
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
 const selected = await inputs.resolveInstallInputs(request);
 if (request.replaceSelectedWith !== undefined) {
  fs.writeFileSync(selected.current.file, request.replaceSelectedWith);
  await inputs.assertInstallerUnchanged(selected.current);
 }
 process.stdout.write(JSON.stringify({ok:true, selected}));
})().catch(error => process.stdout.write(JSON.stringify({ok:false, error:error.message})));
'''


class CandidateSelection(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='keyu-candidate-fixture-')
        self.root = Path(self.temporary.name).resolve()
        (self.root / 'reports').mkdir()
        self.candidate = self.root / 'release/candidate-r8/CampusCourseDesktop-Setup-0.1.5-x64.exe'
        self.candidate.parent.mkdir(parents=True)
        self.candidate.write_bytes(b'explicit-new-candidate-fixture-never-executed')
        self.old = self.root / 'release/CampusCourseDesktop-Setup-0.1.5-x64.exe'
        self.old.write_bytes(b'explicit-older-same-version-fixture-never-executed')
        self.initial = self.root / 'release/CampusCourseDesktop-Setup-0.1.4-x64.exe'
        self.initial.write_bytes(b'explicit-upgrade-start-fixture-never-executed')
        self.identity = {'passed': True, 'version': '0.1.5',
                         'installerPath': self.candidate.relative_to(self.root).as_posix(),
                         'installerSha256': hashlib.sha256(self.candidate.read_bytes()).hexdigest()}
        self.save_identity()

    def tearDown(self):
        assert self.root.parent == Path(tempfile.gettempdir()).resolve()
        self.temporary.cleanup()

    def save_identity(self):
        (self.root / 'reports/release-integrity.json').write_text(json.dumps(self.identity), encoding='utf-8')

    def node_selection(self, argv=None, **extra):
        request = {'root': str(self.root), 'version': '0.1.5', 'argv': argv or [], **extra}
        result = subprocess.run(['node', '-e', NODE_CODE, str(PROJECT / 'scripts/install-inputs.cjs')],
                                input=json.dumps(request), text=True, capture_output=True, timeout=20,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_default_uses_verified_candidate_instead_of_old_root_installer(self):
        result = self.node_selection()
        self.assertTrue(result['ok'], result)
        self.assertEqual(Path(result['selected']['current']['file']), self.candidate)
        self.assertEqual(result['selected']['current'], result['selected']['initial'])
        self.assertEqual(bundle.resolve_verified_installer(self.identity, self.root, '0.1.5'), self.candidate)

    def test_rejects_explicit_older_candidate_with_same_version(self):
        result = self.node_selection(['--installer', str(self.old)])
        self.assertFalse(result['ok'])
        self.assertIn('different candidate', result['error'])

    def test_accepts_explicit_copy_with_identical_verified_bytes(self):
        copy = self.root / 'release/acceptance-r8' / self.candidate.name
        copy.parent.mkdir()
        copy.write_bytes(self.candidate.read_bytes())
        result = self.node_selection(['--installer', str(copy)])
        self.assertTrue(result['ok'], result)
        self.assertEqual(Path(result['selected']['current']['file']), copy)

    def test_upgrade_start_does_not_replace_current_verified_candidate(self):
        for argv in ([str(self.initial)], ['--upgrade-from', str(self.initial)]):
            with self.subTest(argv=argv):
                result = self.node_selection(argv)
                self.assertTrue(result['ok'], result)
                self.assertEqual(Path(result['selected']['current']['file']), self.candidate)
                self.assertEqual(Path(result['selected']['initial']['file']), self.initial)

    def test_rejects_upgrade_start_without_isolated_profile_support(self):
        old = self.root / 'release/CampusCourseDesktop-Setup-0.1.3-x64.exe'
        old.write_bytes(b'explicit-unsupported-start-fixture-never-executed')
        result = self.node_selection(['--upgrade-from', str(old)])
        self.assertFalse(result['ok'])
        self.assertIn('0.1.4 or newer', result['error'])

    def test_rejects_missing_or_failed_current_identity(self):
        for field, value in (('passed', False), ('version', '0.1.4'), ('installerPath', None), ('installerSha256', '')):
            with self.subTest(field=field):
                original = self.identity[field]
                self.identity[field] = value
                self.save_identity()
                self.assertFalse(self.node_selection()['ok'])
                with self.assertRaises(AssertionError):
                    bundle.resolve_verified_installer(self.identity, self.root, '0.1.5')
                self.identity[field] = original

    def test_rejects_changed_candidate_without_falling_back_to_root(self):
        self.candidate.write_bytes(b'explicit-tampered-fixture-never-executed')
        result = self.node_selection()
        self.assertFalse(result['ok'])
        self.assertIn('changed', result['error'])
        with self.assertRaisesRegex(AssertionError, 'changed'):
            bundle.resolve_verified_installer(self.identity, self.root, '0.1.5')

    def test_rechecks_candidate_before_install_actions(self):
        result = self.node_selection(replaceSelectedWith='explicit-replacement-fixture-never-executed')
        self.assertFalse(result['ok'])
        self.assertIn('changed during verification', result['error'])

    def test_rejects_ambiguous_or_outside_report_paths(self):
        for raw in ('../release/' + self.candidate.name, 'release/../release/' + self.candidate.name,
                    'release/candidate-r8\\..\\' + self.candidate.name, str(self.candidate)):
            with self.subTest(raw=raw):
                self.identity['installerPath'] = raw
                self.save_identity()
                self.assertFalse(self.node_selection()['ok'])
                with self.assertRaises(AssertionError):
                    bundle.resolve_verified_installer(self.identity, self.root, '0.1.5')

    def test_rejects_outside_explicit_installer(self):
        result = self.node_selection(['--installer', str(self.root.parent / self.candidate.name)])
        self.assertFalse(result['ok'])
        self.assertIn('inside this project', result['error'])

    def test_rejects_unknown_duplicate_or_incomplete_options(self):
        for argv in (['--installer'], ['--unknown'], ['--installer', str(self.candidate), '--installer', str(self.candidate)],
                     ['--upgrade-from', str(self.initial), str(self.initial)]):
            with self.subTest(argv=argv):
                self.assertFalse(self.node_selection(argv)['ok'])

    def test_delivery_outputs_stay_with_the_candidate(self):
        directory, outputs = bundle.bundle_outputs(self.candidate, '0.1.5')
        self.assertEqual(directory, self.candidate.parent)
        self.assertTrue(all(file.parent == directory for file in outputs))
        self.assertEqual(self.old.read_bytes(), b'explicit-older-same-version-fixture-never-executed')

    def test_delivery_refuses_existing_zip_manifest_or_checksums(self):
        _, outputs = bundle.bundle_outputs(self.candidate, '0.1.5')
        for file in outputs:
            with self.subTest(file=file.name):
                file.write_bytes(b'explicit-existing-artifact-fixture')
                with self.assertRaisesRegex(AssertionError, 'already exists'):
                    bundle.bundle_outputs(self.candidate, '0.1.5')
                self.assertEqual(file.read_bytes(), b'explicit-existing-artifact-fixture')
                file.unlink()

    def test_bundle_pipeline_preserves_prior_root_delivery_and_uses_candidate(self):
        source_files = ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'electron-builder.yml',
                        'electron.vite.config.ts', 'playwright.config.ts', 'tsconfig.json', 'vitest.config.ts',
                        '.gitignore', '.gitattributes', '.npmrc', 'README.md', 'PRODUCT_PLAN.md', 'LICENSE', 'AGENTS.md',
                        'src/main/index.ts', 'out/main/index.js')
        for name in source_files:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('explicit-source-fixture', encoding='utf-8')
        self.identity.update(lockSha256=bundle.sha256(self.root / 'pnpm-lock.yaml'), lockedPackageCount=1,
                             outputHashes={'out/main/index.js': bundle.sha256(self.root / 'out/main/index.js')})
        reports = {
            'unit-results.json': {'numFailedTests': 0, 'numPassedTests': 1},
            'e2e-results.json': desktop_report(1),
            'soak-result.json': {'passed': True, 'version': '0.1.5', 'elapsedMs': 15000},
            'packaged-smoke.json': {'passed': True, 'isolatedVerification': True, 'environment': {'version': '0.1.5'}},
            'install-smoke.json': {'passed': True, 'isolatedVerification': True, 'toVersion': '0.1.5', 'installerSha256': self.identity['installerSha256']},
            'public-entry-smoke.json': {'passed': True, 'version': '0.1.5'},
            'release-integrity.json': self.identity,
        }
        for name, report in reports.items():
            (self.root / 'reports' / name).write_text(json.dumps(report), encoding='utf-8')
        prior = self.root / 'release/SHA256SUMS.txt'
        prior.write_bytes(b'explicit-prior-release-checksums')
        with patch.object(bundle, 'ROOT', self.root), patch.object(bundle, 'read_json', side_effect=reports.__getitem__):
            with contextlib.redirect_stdout(io.StringIO()):
                bundle.main()
            source_archive = self.candidate.parent / 'CampusCourseDesktop-Source-0.1.5.zip'
            original_archive = source_archive.read_bytes()
            manifest = json.loads((self.candidate.parent / 'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['artifactDirectory'], 'release/candidate-r8')
            self.assertEqual(manifest['artifacts'][0]['sha256'], self.identity['installerSha256'])
            self.assertEqual(prior.read_bytes(), b'explicit-prior-release-checksums')
            self.assertFalse((self.root / 'release' / source_archive.name).exists())
            with self.assertRaisesRegex(AssertionError, 'already exists'):
                bundle.main()
            self.assertEqual(source_archive.read_bytes(), original_archive)


if __name__ == '__main__':
    unittest.main()
