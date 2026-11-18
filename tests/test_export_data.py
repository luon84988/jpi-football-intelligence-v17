import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request

import export_data


class ExportDataTests(unittest.TestCase):
    def test_production_health_uses_same_optional_api_key_as_export(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/production_health.yml").read_text(encoding="utf-8")
        self.assertIn('API_KEY: ${{ secrets.API_KEY }}', workflow)
        self.assertIn('JPI_API_URL: ${{ vars.JPI_API_URL }}', workflow)

    def test_sites_header_and_no_unrelated_provider_credential(self):
        endpoint = "https://" + export_data.SITES_SERVICE_HOST + "/api/football/live"
        with patch.dict("os.environ", {"SITES_SERVICE_TOKEN": "unit-test-token", "API_KEY": "unrelated-provider"}, clear=True):
            request, authenticated = export_data.api_request(endpoint)
        self.assertTrue(authenticated)
        self.assertEqual(request.get_header("Oai-sites-authorization"), "Bearer unit-test-token")
        self.assertIsNone(request.get_header("Authorization"))

    def test_service_token_is_bound_to_exact_host_and_route(self):
        root = "https://" + export_data.SITES_SERVICE_HOST
        with patch.dict("os.environ", {"SITES_SERVICE_TOKEN": "unit-test-token"}, clear=True):
            for endpoint in ["https://other.example/api/football/live", root + ".evil.example/api/football/live", root.replace("https:", "http:") + "/api/football/live", root + ":444/api/football/live", root + "/other", root + "/api/football/live?url=other", root + "/api/football/live#other", root.replace("https://", "https://user:password@") + "/api/football/live"]:
                with self.subTest(endpoint=endpoint), self.assertRaises(export_data.ExportError):
                    export_data.api_request(endpoint)

    def test_sites_requires_dedicated_secret(self):
        with patch.dict("os.environ", {"API_KEY": "not-a-sites-token"}, clear=True):
            with self.assertRaisesRegex(export_data.ExportError, "SITES_SERVICE_TOKEN"):
                export_data.api_request("https://" + export_data.SITES_SERVICE_HOST + "/api/football/live")

    def test_credential_redirect_never_creates_followup_request(self):
        handler = export_data.RejectCredentialRedirects()
        for code in (301, 302, 303, 307, 308):
            with self.subTest(code=code), self.assertRaises(export_data.ExportError):
                handler.redirect_request(Request("https://example.com/"), None, code, "redirect", {}, "https://other.example/")

    def test_both_jobs_wire_dedicated_secret(self):
        root = Path(__file__).resolve().parents[1]
        for name, count in [("auto_run.yml", 3), ("production_health.yml", 1)]:
            workflow = (root / ".github/workflows" / name).read_text()
            self.assertEqual(workflow.count('SITES_SERVICE_TOKEN: ${{ secrets.SITES_SERVICE_TOKEN }}'), count)

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

    def test_official_fixture_exports_without_model_or_prices(self):
        fixture = {
            "league": "测试联赛",
            "home": "主队",
            "away": "客队",
            "sourceEventId": "123",
            "kickoff": "2026-10-20T15:30:00+08:00",
        }
        source = {
            "updatedAt": "2026-10-20T06:30:00Z",
            "source": "中国体育彩票官方竞彩",
            "sourceHealth": {"succeeded": 1, "hasData": True},
            "matches": [fixture],
        }
        expected = export_data.build_dashboard_payload(source)["matches"][0]
        self.assertEqual(expected["match_id"], "123")
        self.assertEqual(expected["kickoff"], fixture["kickoff"])
        self.assertEqual(expected["probability_basis"], "UNAVAILABLE")
        for key in ("prob_home", "prob_draw", "prob_away"):
            self.assertIsNone(expected[key])
        self.assertNotIn("odds", expected)
        for legacy_prices in (["2.00", "3.00", "4.00"], ["—"], None):
            fixture["odds"] = legacy_prices
            self.assertEqual(export_data.build_dashboard_payload(source)["matches"][0], expected)
        source["matches"].append(dict(fixture))
        with self.assertRaisesRegex(export_data.ExportError, "Duplicate source match identity"):
            export_data.build_dashboard_payload(source)

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
            }],
        }
        with self.assertRaises(export_data.ExportError):
            export_data.build_dashboard_payload(source)


if __name__ == "__main__":
    unittest.main()


