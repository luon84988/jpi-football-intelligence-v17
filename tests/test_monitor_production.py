"""Production health must reflect publishable odds, not raw fixture count."""
import io
import json
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from scripts import monitor_production as monitor
from export_data import ExportError


def official_payload(matches):
    return {
        "source": "中国体育彩票官方竞彩",
        "updatedAt": "2026-10-25T00:00:00Z",
        "sourceHealth": {"succeeded": 1, "hasData": True},
        "matches": matches,
    }


def fixture(odds):
    return {
        "sourceEventId": "official-123",
        "league": "测试联赛",
        "home": "主队",
        "away": "客队",
        "odds": odds,
    }


class MonitorProductionTests(unittest.TestCase):
    def run_monitor(self, payload):
        stdout = io.StringIO()
        with patch.dict(os.environ, {"JPI_API_URL": "https://worker.example.test"}, clear=True):
            with patch.object(monitor, "fetch_live_data", return_value=payload):
                with redirect_stdout(stdout):
                    code = monitor.check()
        return code, json.loads(stdout.getvalue())

    def test_counts_only_publishable_official_matches(self):
        payload = official_payload([fixture(["2.1", "3.2", "3.7"]), fixture(["—", "—", "—"])])
        code, result = self.run_monitor(payload)
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["matches"], 1)
        self.assertEqual(result["rawMatches"], 2)
        self.assertEqual(result["invalidMatches"], 1)
        self.assertEqual(result["probabilityBasis"], "de-vigged_market_odds")

    def test_rejects_all_unpriced_fixtures(self):
        with self.assertRaisesRegex(ExportError, "No valid matches"):
            self.run_monitor(official_payload([fixture(["—", "—", "—"])]))

    def test_rejects_fallback_even_if_it_contains_odds(self):
        payload = official_payload([fixture(["2", "3", "4"])])
        payload["source"] = "ESPN fallback"
        with self.assertRaises(ExportError):
            self.run_monitor(payload)

    def test_missing_worker_url_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ExportError, "JPI_API_URL is not configured"):
                monitor.check()


if __name__ == "__main__":
    unittest.main()
