from pathlib import Path
import subprocess
import unittest


class DashboardFreshnessTests(unittest.TestCase):
    def test_static_page_expires_source_evidence(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(['node', '--test', 'tests/dashboard-freshness.test.mjs'],
                                cwd=root, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
