"""Offline checks for source bundling evidence; never install or create artifacts."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('source_bundle', Path(__file__).parents[2] / 'scripts/source-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def desktop_report(count=9):
    return {
        'errors': [],
        'stats': {'expected': count, 'unexpected': 0, 'flaky': 0, 'skipped': 0},
        'suites': [{'title': 'explicit desktop fixtures', 'specs': [
            {'id': f'fixture-{index}', 'ok': True, 'tests': [{
                'projectName': 'desktop', 'projectId': 'desktop',
                'expectedStatus': 'passed', 'status': 'expected',
                'results': [{'status': 'passed', 'retry': 0, 'errors': []}],
            }]} for index in range(count)
        ]}],
    }


class SourceEvidenceValidation(unittest.TestCase):
    def setUp(self):
        self.report = desktop_report()
        self.test = self.report['suites'][0]['specs'][0]['tests'][0]

    def test_accepts_current_and_growing_complete_suites(self):
        for count in (9, 12):
            with self.subTest(count=count):
                report = desktop_report(count)
                report['suites'] = [{'title': 'nested fixtures', 'suites': report['suites']}]
                self.assertEqual(bundle.validate_desktop_report(report), count)

    def test_rejects_empty_and_summary_only_reports(self):
        for report in (desktop_report(0), {'stats': self.report['stats'], 'errors': [], 'suites': []}):
            with self.subTest(report=report):
                with self.assertRaises(AssertionError):
                    bundle.validate_desktop_report(report)

    def test_rejects_statistics_without_matching_executions(self):
        self.report['stats']['expected'] = 10
        with self.assertRaisesRegex(AssertionError, 'do not match'):
            bundle.validate_desktop_report(self.report)

    def test_rejects_failures_flakiness_skips_and_invalid_counts(self):
        for field in ('unexpected', 'flaky', 'skipped'):
            for value in (1, None, False):
                with self.subTest(field=field, value=value):
                    report = desktop_report()
                    report['stats'][field] = value
                    with self.assertRaises(AssertionError):
                        bundle.validate_desktop_report(report)

    def test_rejects_global_errors_even_when_statistics_claim_success(self):
        self.report['errors'] = [{'message': 'explicit reporter error fixture'}]
        with self.assertRaises(AssertionError):
            bundle.validate_desktop_report(self.report)

    def test_rejects_failed_or_skipped_execution_under_successful_summary(self):
        for status in ('failed', 'skipped', 'timedOut', 'interrupted'):
            with self.subTest(status=status):
                self.test['results'][0]['status'] = status
                with self.assertRaises(AssertionError):
                    bundle.validate_desktop_report(self.report)

    def test_expected_failures_are_not_successful_delivery_tests(self):
        self.test['expectedStatus'] = 'failed'
        with self.assertRaises(AssertionError):
            bundle.validate_desktop_report(self.report)

    def test_rejects_retry_hidden_by_zero_flaky_count(self):
        self.test['results'] = [
            {'status': 'failed', 'retry': 0, 'errors': []},
            {'status': 'passed', 'retry': 1, 'errors': []},
        ]
        with self.assertRaises(AssertionError):
            bundle.validate_desktop_report(self.report)

    def test_rejects_execution_errors_hidden_by_passed_status(self):
        for field in ('errors', 'error'):
            with self.subTest(field=field):
                report = desktop_report()
                report['suites'][0]['specs'][0]['tests'][0]['results'][0][field] = [{'message': 'explicit error fixture'}]
                with self.assertRaises(AssertionError):
                    bundle.validate_desktop_report(report)

    def test_rejects_missing_specifications_tests_and_execution_fields(self):
        for field in ('id', 'tests', 'results', 'errors', 'retry'):
            with self.subTest(field=field):
                report = desktop_report()
                specification = report['suites'][0]['specs'][0]
                test = specification['tests'][0]
                target = specification if field in ('id', 'tests') else test if field == 'results' else test['results'][0]
                del target[field]
                with self.assertRaises(AssertionError):
                    bundle.validate_desktop_report(report)

    def test_rejects_duplicate_specification_and_test_entries(self):
        for duplicate_spec in (True, False):
            with self.subTest(duplicate_spec=duplicate_spec):
                report = desktop_report()
                specification = report['suites'][0]['specs'][0]
                if duplicate_spec:
                    report['suites'][0]['specs'].append(copy.deepcopy(specification))
                else:
                    specification['tests'].append(copy.deepcopy(specification['tests'][0]))
                report['stats']['expected'] += 1
                with self.assertRaises(AssertionError):
                    bundle.validate_desktop_report(report)

    def test_rejects_other_project_and_empty_nested_suite(self):
        for wrong_project in (True, False):
            with self.subTest(wrong_project=wrong_project):
                report = desktop_report()
                if wrong_project:
                    report['suites'][0]['specs'][0]['tests'][0]['projectName'] = 'soak'
                else:
                    report['suites'].append({'title': 'empty fixture suite', 'specs': []})
                with self.assertRaises(AssertionError):
                    bundle.validate_desktop_report(report)

    def test_desktop_success_does_not_bypass_install_acceptance(self):
        reports = {
            'unit-results.json': {'numFailedTests': 0, 'numPassedTests': 1},
            'e2e-results.json': desktop_report(),
            'soak-result.json': {'passed': True},
            'packaged-smoke.json': {'passed': True},
            'install-smoke.json': {'passed': False},
        }
        with patch.object(bundle, 'read_json', side_effect=reports.__getitem__):
            with patch.object(bundle.zipfile, 'ZipFile') as archive:
                with self.assertRaises(AssertionError):
                    bundle.main()
                archive.assert_not_called()


if __name__ == '__main__':
    unittest.main()
