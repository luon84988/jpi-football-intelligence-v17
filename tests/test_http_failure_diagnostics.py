import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import export_data


class HTTPFailureDiagnosticsTests(unittest.TestCase):
    def error(self, body):
        return HTTPError('https://example.test/api/football/live?private=do-not-log',
                         503, 'Service unavailable', {'Content-Type': 'application/json'},
                         io.BytesIO(body))

    def fetch_error(self, body):
        with patch.dict('os.environ', {}, clear=True), patch.object(
                export_data, 'urlopen', side_effect=self.error(body)) as request:
            with self.assertRaises(export_data.ExportError) as caught:
                export_data.fetch_live_data('https://example.test/api/football/live')
            request.assert_called_once()
        return str(caught.exception)

    def test_worker_503_keeps_bounded_structured_reason_and_upstream_status(self):
        message = self.fetch_error(json.dumps({
            'error': 'OFFICIAL_SOURCE_TEMPORARILY_UNAVAILABLE', 'stale': True,
            'sourceAttempt': {'status': 567, 'outcome': 'http_error'},
        }).encode())
        self.assertIn('HTTP 503', message)
        self.assertIn('worker_error=OFFICIAL_SOURCE_TEMPORARILY_UNAVAILABLE', message)
        self.assertIn('stale=true', message)
        self.assertIn('upstream_status=567', message)
        self.assertIn('upstream_outcome=http_error', message)

    def test_html_invalid_unicode_non_object_and_oversized_bodies_are_not_logged(self):
        for body in (b'<html>private-token</html>', b'\xffprivate-token', b'[]',
                     b'null', b'private-token' * 1000):
            with self.subTest(body=body[:20]):
                self.assertEqual(self.fetch_error(body), 'Live API returned HTTP 503.')

    def test_only_known_codes_booleans_and_real_http_statuses_can_reach_logs(self):
        message = self.fetch_error(json.dumps({
            'error': 'private-token\n::notice::injected', 'stale': 'private-token',
            'sourceAttempt': {'status': True, 'outcome': 'private-token'},
            'message': 'private-token', 'headers': {'Authorization': 'private-token'},
        }).encode())
        self.assertEqual(message, 'Live API returned HTTP 503.')
        for status in ('567', 0, 600, None):
            with self.subTest(status=status):
                self.assertNotIn('upstream_status=', self.fetch_error(
                    json.dumps({'sourceAttempt': {'status': status}}).encode()))

    def test_body_read_is_bounded_and_cannot_replace_the_original_http_error(self):
        error = self.error(b'')
        with patch.object(error, 'read', side_effect=TimeoutError('private-token')) as read:
            with patch.dict('os.environ', {}, clear=True), patch.object(export_data, 'urlopen', side_effect=error):
                with self.assertRaisesRegex(export_data.ExportError, '^Live API returned HTTP 503\\.$'):
                    export_data.fetch_live_data('https://example.test/api/football/live')
        read.assert_called_once_with(8193)

    def test_http_failure_never_replaces_last_dashboard_or_returns_success(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / 'dashboard_data.json'
            destination.write_bytes(b'preserved prior snapshot')
            body = json.dumps({'stale': True, 'sourceAttempt': {'status': 567, 'outcome': 'http_error'}}).encode()
            with patch.dict('os.environ', {'JPI_API_URL': 'https://example.test'}, clear=True), \
                 patch.object(export_data, 'OUTPUT', destination), \
                 patch.object(export_data, 'urlopen', side_effect=self.error(body)), \
                 patch('sys.stderr', new_callable=io.StringIO) as stderr:
                self.assertEqual(export_data.main(), 2)
            self.assertIn('upstream_status=567', stderr.getvalue())
            self.assertNotIn('private=', stderr.getvalue())
            self.assertEqual(destination.read_bytes(), b'preserved prior snapshot')



    def test_fetch_error_exposes_typed_upstream_retry_context(self):
        body = json.dumps({
            'error': 'OFFICIAL_SOURCE_TEMPORARILY_UNAVAILABLE', 'stale': True,
            'sourceAttempt': {'status': 567, 'outcome': 'http_error'},
        }).encode()
        with patch.dict('os.environ', {}, clear=True), patch.object(
                export_data, 'urlopen', side_effect=self.error(body)):
            with self.assertRaises(export_data.LiveHTTPError) as caught:
                export_data.fetch_live_data('https://example.test/api/football/live')
        self.assertEqual(caught.exception.status, 503)
        self.assertEqual(caught.exception.upstream_status, 567)
        self.assertEqual(caught.exception.upstream_outcome, 'http_error')
        self.assertNotIn('private=', str(caught.exception))

if __name__ == '__main__':
    unittest.main()
