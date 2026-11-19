from unittest import TestCase
from unittest.mock import patch

from scripts import monitor_production


class ProductionMonitorRetryTests(TestCase):
    def test_503_is_retried_once(self):
        error = monitor_production.LiveHTTPError(503, "upstream unavailable")
        payload = {"matches": []}
        with (
            patch.object(monitor_production, "fetch_live_data", side_effect=[error, payload]) as fetch,
            patch.object(monitor_production, "sleep") as pause,
        ):
            self.assertIs(monitor_production.read_current_feed("endpoint"), payload)
        self.assertEqual(fetch.call_count, 2)
        pause.assert_called_once_with(20)

    def test_persistent_503_and_non_503_keep_failing(self):
        for status, expected_calls in ((503, 2), (403, 1)):
            with self.subTest(status=status):
                error = monitor_production.LiveHTTPError(status, "upstream unavailable")
                with (
                    patch.object(monitor_production, "fetch_live_data", side_effect=error) as fetch,
                    patch.object(monitor_production, "sleep"),
                    self.assertRaises(monitor_production.LiveHTTPError),
                ):
                    monitor_production.read_current_feed("endpoint")
                self.assertEqual(fetch.call_count, expected_calls)
