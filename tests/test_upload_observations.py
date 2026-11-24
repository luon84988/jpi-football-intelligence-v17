import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from scripts import upload_observations


class UploadObservationsTests(TestCase):
    def test_empty_current_match_set_skips_private_d1_upload(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            reports = root / "reports"
            reports.mkdir()
            (reports / "domestic-latest.json").write_text(
                json.dumps(
                    {
                        "matches": [],
                        "sources": [
                            {"source": "500", "status": "success"},
                            {"source": "okooo", "status": "success"},
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch.object(upload_observations, "ROOT", root),
                patch.object(upload_observations, "api_request") as api_request,
                patch.object(upload_observations, "build_opener") as build_opener,
                patch("builtins.print"),
            ):
                result = upload_observations.upload()

            self.assertEqual(result["status"], "skipped")
            self.assertFalse(result["persisted"])
            self.assertFalse(result["raw_captures_persisted"])
            self.assertEqual(result["reason"], "no_current_cross_checked_matches")
            self.assertEqual(result["source_count"], 2)
            api_request.assert_not_called()
            build_opener.assert_not_called()


if __name__ == "__main__":
    import unittest

    unittest.main()
