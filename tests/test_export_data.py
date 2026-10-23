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

    def test_missing_stable_event_id_fails_closed(self):
        source = {
            "updatedAt": "2026-10-20T06:30:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": [{"league": "测试", "home": "主", "away": "客",
                         "odds": ["2.00", "3.00", "4.00"]}],
        }
        with self.assertRaisesRegex(export_data.ExportError, "event ID"):
            export_data.build_dashboard_payload(source)
        source["matches"][0]["sourceEventId"] = "undefined"
        with self.assertRaisesRegex(export_data.ExportError, "event ID"):
            export_data.build_dashboard_payload(source)

    def test_duplicate_stable_event_id_fails_closed(self):
        match = {"league": "测试", "home": "主", "away": "客",
                 "odds": ["2.00", "3.00", "4.00"], "sourceEventId": "match-1"}
        source = {
            "updatedAt": "2026-10-20T06:30:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": [match, {**match, "home": "另一主队"}],
        }
        with self.assertRaisesRegex(export_data.ExportError, "Duplicate"):
            export_data.build_dashboard_payload(source)

    def test_match_number_fallback_is_normalized(self):
        source = {
            "updatedAt": "2026-10-20T06:30:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": [{"league": "测试", "home": "主", "away": "客",
                         "odds": ["2.00", "3.00", "4.00"], "matchNum": 42}],
        }
        output = export_data.build_dashboard_payload(source)
        self.assertEqual(output["matches"][0]["match_id"], "42")

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


if __name__ == "__main__":
    unittest.main()
