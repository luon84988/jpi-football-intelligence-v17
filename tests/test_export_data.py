import unittest

import export_data


class ExportDataTests(unittest.TestCase):
    def test_endpoint_appends_live_route(self):
        self.assertEqual(
            export_data.source_endpoint("https://jpi.example.com/"),
            "https://jpi.example.com/api/football/live",
        )

    def test_endpoint_preserves_full_route(self):
        self.assertEqual(
            export_data.source_endpoint("https://jpi.example.com/api/football/live"),
            "https://jpi.example.com/api/football/live",
        )

    def test_invalid_endpoint_rejected(self):
        with self.assertRaises(export_data.ExportError):
            export_data.source_endpoint("")

    def test_market_probabilities_are_de_vigged(self):
        probabilities = export_data.odds_probabilities(["2.00", "3.00", "4.00"])
        self.assertIsNotNone(probabilities)
        self.assertAlmostEqual(sum(probabilities), 1.0)
        self.assertGreater(probabilities[0], probabilities[1])
        self.assertGreater(probabilities[1], probabilities[2])

    def test_invalid_odds_rejected(self):
        self.assertIsNone(export_data.odds_probabilities(["2.00", "—", "4.00"]))
        self.assertIsNone(export_data.odds_probabilities([1, 2, 3]))

    def test_market_probabilities_are_not_marked_as_ev(self):
        source = {
            "updatedAt": "2026-10-20T06:30:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": [{
                "league": "测试联赛",
                "home": "主队",
                "away": "客队",
                "odds": ["2.00", "3.00", "4.00"],
                "sourceEventId": "test-1",
            }],
        }
        output = export_data.build_dashboard_payload(source)
        self.assertEqual(output["summary"]["ev_positive_count"], 0)
        self.assertIsNone(output["matches"][0]["ev_value"])
        self.assertEqual(output["matches"][0]["probability_basis"], "de-vigged_market_odds")
        self.assertNotIn("+EV", output["matches"][0]["recommendation"])

    def test_fallback_source_rejected(self):
        payload = {"source": "ESPN fallback", "sourceHealth": {"succeeded": 1, "hasData": True}, "updatedAt": "2026-10-20T06:30:00Z", "matches": [{"league": "测试", "home": "主", "away": "客", "odds": ["2", "3", "4"]}]}
        with self.assertRaises(export_data.ExportError):
            export_data.build_dashboard_payload(payload)

    def test_missing_source_health_rejected(self):
        payload = {"source": "中国体育彩票官方竞彩", "updatedAt": "2026-10-20T06:30:00Z", "matches": [{"league": "测试", "home": "主", "away": "客", "odds": ["2", "3", "4"]}]}
        with self.assertRaises(export_data.ExportError):
            export_data.build_dashboard_payload(payload)

    def test_all_invalid_matches_fail_closed(self):
        source = {
            "updatedAt": "2026-10-20T06:30:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": [{
                "league": "测试联赛",
                "home": "主队",
                "away": "客队",
                "odds": ["—", "—", "—"],
            }],
        }
        with self.assertRaises(export_data.ExportError):
            export_data.build_dashboard_payload(source)



class ProductionMonitorParityTests(unittest.TestCase):
    """A green health check must mean the exporter can publish valid odds."""

    @staticmethod
    def official_payload(odds):
        return {
            "updatedAt": "2026-10-24T05:00:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": [{"league": "测试联赛", "home": "主队", "away": "客队",
                         "sourceEventId": "official-1", "odds": odds}],
        }

    def test_monitor_rejects_unpublishable_odds(self):
        from unittest.mock import patch
        from scripts import monitor_production
        with patch.dict("os.environ", {"JPI_API_URL": "https://jpi.example.com"}), \\
             patch.object(monitor_production, "fetch_live_data", return_value=self.official_payload(["—", "3.2", "4.1"])):
            with self.assertRaises(export_data.ExportError):
                monitor_production.check()

    def test_monitor_reports_exportable_count(self):
        import contextlib
        import io
        import json
        from unittest.mock import patch
        from scripts import monitor_production
        payload = self.official_payload(["2.1", "3.2", "4.1"])
        payload["matches"].append({"league": "测试联赛", "home": "第二主队", "away": "第二客队",
                                   "sourceEventId": "official-2", "odds": ["—", "3.2", "4.1"]})
        output = io.StringIO()
        with patch.dict("os.environ", {"JPI_API_URL": "https://jpi.example.com"}), \\
             patch.object(monitor_production, "fetch_live_data", return_value=payload), \\
             contextlib.redirect_stdout(output):
            self.assertEqual(monitor_production.check(), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["matches"], 1)
        self.assertEqual(result["skippedInvalidMatches"], 1)

if __name__ == "__main__":
    unittest.main()
