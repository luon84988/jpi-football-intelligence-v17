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

    def test_external_http_endpoint_rejected(self):
        with self.assertRaisesRegex(export_data.ExportError, "HTTPS"):
            export_data.source_endpoint("http://jpi.example.com")

    def test_loopback_http_allowed_without_credentials(self):
        self.assertEqual(
            export_data.source_endpoint("http://127.0.0.1:8787"),
            "http://127.0.0.1:8787/api/football/live",
        )

    def test_url_credentials_query_and_fragment_rejected(self):
        for url in (
            "https://user:pass@jpi.example.com",
            "https://jpi.example.com?token=secret",
            "https://jpi.example.com/#fragment",
        ):
            with self.subTest(url=url), self.assertRaises(export_data.ExportError):
                export_data.source_endpoint(url)

    def test_bearer_token_never_sent_to_http_loopback(self):
        from unittest.mock import patch
        with patch.dict("os.environ", {"API_KEY": "test-placeholder"}, clear=False):
            with self.assertRaisesRegex(export_data.ExportError, "requires HTTPS"):
                export_data.fetch_live_data("http://localhost:8787/api/football/live")

    def test_redirect_handler_never_forwards_bearer_to_new_origin(self):
        from urllib.request import Request

        request = Request(
            "https://worker.example.test/api/football/live",
            headers={"Authorization": "Bearer dummy-test-token"},
        )
        self.assertIsNone(
            export_data.RejectRedirects().redirect_request(
                request, None, 302, "Found", {},
                "https://untrusted.example.test/collect",
            )
        )
        self.assertIsNone(
            export_data.RejectRedirects().redirect_request(
                request, None, 302, "Found", {},
                "http://worker.example.test/collect",
            )
        )

    def test_http_redirect_fails_closed_without_following_location(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from unittest.mock import patch

        seen_paths = []

        class RedirectingHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                seen_paths.append(self.path)
                self.send_response(302)
                self.send_header("Location", "/redirected")
                self.end_headers()

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), RedirectingHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            endpoint = f"http://127.0.0.1:{server.server_port}/api/football/live"
            with patch.dict("os.environ", {"API_KEY": ""}):
                with self.assertRaisesRegex(export_data.ExportError, "HTTP 302"):
                    export_data.fetch_live_data(endpoint)
            self.assertEqual(seen_paths, ["/api/football/live"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

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


if __name__ == "__main__":
    unittest.main()
