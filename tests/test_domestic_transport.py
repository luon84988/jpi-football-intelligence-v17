from http.client import RemoteDisconnected
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from scripts import domestic


class DomesticTransportTests(unittest.TestCase):
    def test_wrapped_timeout_then_success(self):
        attempts = []
        result = ("response", "hash", 0)
        with (
            patch.object(domestic, "_fetch_page_once", side_effect=[
                URLError(TimeoutError("private reason text")), result
            ]) as request,
            patch.object(domestic, "sleep") as pause,
        ):
            self.assertEqual(
                domestic.fetch_page(domestic.SOURCES["500"], "500", Path("."), {}, attempts),
                result,
            )
        self.assertEqual(request.call_count, 2)
        pause.assert_called_once_with(1)
        self.assertEqual([a["status"] for a in attempts], ["failed", "success"])
        self.assertEqual(attempts[0]["transport_error"], "TimeoutError")
        self.assertNotIn("private reason text", repr(attempts))

    def test_disconnect_and_direct_timeout_retry_only_once(self):
        for error in (RemoteDisconnected(), TimeoutError()):
            with self.subTest(error=type(error).__name__):
                self.assert_attempts(error, 2)

    def test_http_rejections_and_other_errors_do_not_retry(self):
        url = domestic.SOURCES["500"]
        for error in (HTTPError(url, 503, "unavailable", {}, None),
                      URLError("unclassified"), ValueError("invalid data")):
            with self.subTest(error=type(error).__name__):
                self.assert_attempts(error, 1)

    def assert_attempts(self, error, count):
        attempts = []
        with (
            patch.object(domestic, "_fetch_page_once", side_effect=error) as request,
            patch.object(domestic, "sleep") as pause,
            self.assertRaises(type(error)),
        ):
            domestic.fetch_page(domestic.SOURCES["500"], "500", Path("."), {}, attempts)
        self.assertEqual(request.call_count, count)
        self.assertEqual(pause.call_count, count - 1)
        self.assertEqual([a["status"] for a in attempts], ["failed"] * count)
