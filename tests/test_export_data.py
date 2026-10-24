import unittest

import export_data


class ExportDataTests(unittest.TestCase):
    @staticmethod
    def _official_payload(matches):
        return {
            "updatedAt": "2026-10-24T06:30:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": matches,
        }

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


    def test_identical_official_event_duplicates_are_collapsed(self):
        match = {
            "sourceEventId": "2041001", "matchNum": "周日001",
            "league": "测试联赛", "home": "主队", "away": "客队",
            "odds": ["2.00", "3.00", "4.00"], "time": "10/25 19:00",
        }
        result = export_data.build_dashboard_payload(self._official_payload([match, dict(match)]))
        self.assertEqual(result["summary"]["total_matches"], 1)
        self.assertEqual(result["summary"]["skipped_duplicate_matches"], 1)
        self.assertEqual(result["matches"][0]["match_id"], "2041001")

    def test_equivalent_numeric_odds_duplicates_are_collapsed(self):
        first = {
            "sourceEventId": "2041001", "league": "测试",
            "home": "主队", "away": "客队", "odds": ["2", "3.0", "4.00"],
        }
        second = {**first, "odds": [2.0, 3.0, 4.0]}
        result = export_data.build_dashboard_payload(self._official_payload([first, second]))
        self.assertEqual(result["summary"]["total_matches"], 1)
        self.assertEqual(result["summary"]["skipped_duplicate_matches"], 1)

    def test_conflicting_odds_for_same_event_fail_closed(self):
        first = {
            "sourceEventId": "2041001", "league": "测试",
            "home": "主队", "away": "客队", "odds": ["2", "3", "4"],
        }
        second = {**first, "odds": ["1.8", "3", "4"]}
        with self.assertRaisesRegex(export_data.ExportError, "Conflicting official observations"):
            export_data.build_dashboard_payload(self._official_payload([first, second]))

    def test_conflicting_teams_for_same_event_fail_closed(self):
        first = {
            "sourceEventId": "2041001", "league": "测试",
            "home": "主队", "away": "客队", "odds": ["2", "3", "4"],
        }
        second = {**first, "away": "另一客队"}
        with self.assertRaisesRegex(export_data.ExportError, "Conflicting official observations"):
            export_data.build_dashboard_payload(self._official_payload([first, second]))

    def test_match_number_without_stable_official_id_is_not_published(self):
        match = {
            "matchNum": "周日001", "league": "测试",
            "home": "主队", "away": "客队", "odds": ["2", "3", "4"],
        }
        with self.assertRaisesRegex(export_data.ExportError, "No valid matches"):
            export_data.build_dashboard_payload(self._official_payload([match]))

    def test_distinct_official_event_ids_are_preserved(self):
        first = {
            "sourceEventId": "2041001", "league": "测试",
            "home": "主队", "away": "客队", "odds": ["2", "3", "4"],
        }
        second = {**first, "sourceEventId": "2041002"}
        result = export_data.build_dashboard_payload(self._official_payload([first, second]))
        self.assertEqual(result["summary"]["total_matches"], 2)
        self.assertEqual(result["summary"]["skipped_duplicate_matches"], 0)

if __name__ == "__main__":
    unittest.main()
