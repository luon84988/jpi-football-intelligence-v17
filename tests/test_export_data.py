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
            "persistence": {"status": "verified", "snapshotHash": "a" * 64},
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

    def test_d1_persistence_attestation_required(self):
        valid = {"persistence": {"status": "verified", "snapshotHash": "a" * 64}}
        self.assertEqual(export_data.require_verified_persistence(valid), "a" * 64)
        for proof in (None, {}, {"status": "pending"},
                      {"status": "verified", "snapshotHash": "bad"},
                      {"status": "verified", "snapshotHash": "Z" * 64}):
            with self.subTest(proof=proof):
                with self.assertRaises(export_data.ExportError):
                    export_data.require_verified_persistence({"persistence": proof})

    def test_dashboard_contains_persistence_evidence(self):
        payload = {
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "persistence": {"status": "verified", "snapshotHash": "b" * 64},
            "timestampProvenance": "worker_retrieval_only",
            "updatedAt": "2026-10-23T08:00:00Z",
            "matches": [{"sourceEventId": "m1", "league": "测试", "home": "主",
                         "away": "客", "odds": ["2.1", "3.3", "3.8"]}],
        }
        output = export_data.build_dashboard_payload(payload)
        self.assertEqual(output["snapshot_hash"], "b" * 64)
        self.assertEqual(output["persistence_status"], "verified")
        self.assertEqual(output["timestamp_provenance"], "worker_retrieval_only")

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
            "persistence": {"status": "verified", "snapshotHash": "a" * 64},
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
