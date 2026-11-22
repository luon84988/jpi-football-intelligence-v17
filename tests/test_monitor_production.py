from unittest import TestCase
from unittest.mock import patch

from scripts import monitor_production


class ProductionMonitorRetryTests(TestCase):
    def test_transient_upstream_503_is_retried_once(self):
        error = monitor_production.LiveHTTPError(
            503, "upstream unavailable", upstream_status=503, upstream_outcome="http_error"
        )
        payload = {"matches": []}
        with (
            patch.object(monitor_production, "fetch_live_data", side_effect=[error, payload]) as fetch,
            patch.object(monitor_production, "sleep") as pause,
        ):
            self.assertIs(monitor_production.read_current_feed("endpoint"), payload)
        self.assertEqual(fetch.call_count, 2)
        pause.assert_called_once_with(20)

    def test_567_security_policy_block_is_not_retried(self):
        error = monitor_production.LiveHTTPError(
            503, "upstream_status=567; upstream_outcome=http_error",
            upstream_status=567, upstream_outcome="http_error",
        )
        with (
            patch.object(monitor_production, "fetch_live_data", side_effect=error) as fetch,
            patch.object(monitor_production, "sleep") as pause,
            self.assertRaises(monitor_production.LiveHTTPError),
        ):
            monitor_production.read_current_feed("endpoint")
        self.assertEqual(fetch.call_count, 1)
        pause.assert_not_called()

    def test_non_transient_and_unclassified_503_are_not_retried(self):
        errors = (
            monitor_production.LiveHTTPError(503, "upstream_status=403", upstream_status=403,
                                             upstream_outcome="http_error"),
            monitor_production.LiveHTTPError(503, "no structured upstream diagnostics"),
            monitor_production.LiveHTTPError(403, "forbidden", upstream_status=403,
                                             upstream_outcome="http_error"),
            monitor_production.LiveHTTPError(403, "worker auth failure with transient upstream metadata",
                                             upstream_status=503, upstream_outcome="http_error"),
        )
        for error in errors:
            with self.subTest(error=str(error)):
                with (
                    patch.object(monitor_production, "fetch_live_data", side_effect=error) as fetch,
                    patch.object(monitor_production, "sleep") as pause,
                    self.assertRaises(monitor_production.LiveHTTPError),
                ):
                    monitor_production.read_current_feed("endpoint")
                self.assertEqual(fetch.call_count, 1)
                pause.assert_not_called()

    def test_timeout_outcome_is_retried_once(self):
        error = monitor_production.LiveHTTPError(
            503, "upstream_outcome=timeout", upstream_outcome="timeout"
        )
        payload = {"matches": []}
        with (
            patch.object(monitor_production, "fetch_live_data", side_effect=[error, payload]) as fetch,
            patch.object(monitor_production, "sleep") as pause,
        ):
            self.assertIs(monitor_production.read_current_feed("endpoint"), payload)
        self.assertEqual(fetch.call_count, 2)
        pause.assert_called_once_with(20)

    def test_persistent_transient_503_is_retried_once_then_fails(self):
        error = monitor_production.LiveHTTPError(
            503, "upstream_status=503", upstream_status=503, upstream_outcome="http_error"
        )
        with (
            patch.object(monitor_production, "fetch_live_data", side_effect=error) as fetch,
            patch.object(monitor_production, "sleep") as pause,
            self.assertRaises(monitor_production.LiveHTTPError),
        ):
            monitor_production.read_current_feed("endpoint")
        self.assertEqual(fetch.call_count, 2)
        pause.assert_called_once_with(20)
