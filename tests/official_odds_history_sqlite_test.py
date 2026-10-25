"""Verify the exact Worker SQL against SQLite (no mock database)."""
from __future__ import annotations

import re
import sqlite3
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "worker" / "official-odds-history.ts"


def statement(start: str) -> str:
    source = SOURCE.read_text(encoding="utf-8")
    queries = re.findall(r"db\.prepare\(`(.*?)`\)", source, flags=re.DOTALL)
    matching = [sql for sql in queries if sql.strip().startswith(start)]
    if len(matching) != 1:
        raise AssertionError(f"Expected one SQL statement starting {start!r}; got {len(matching)}")
    return matching[0]


class OfficialOddsTransitionSQL(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        for name in (
            "CREATE TABLE IF NOT EXISTS official_odds_snapshot_history",
            "CREATE TABLE IF NOT EXISTS official_odds_transition_history",
            "CREATE TABLE IF NOT EXISTS official_odds_transition_head",
        ):
            self.db.execute(statement(name))

    def tearDown(self):
        self.db.close()

    def append(self, market_hash: str, observed_at: str):
        with self.db:
            self.db.execute(
                statement("INSERT OR IGNORE INTO official_odds_snapshot_history"),
                (market_hash, observed_at, "中国体育彩票官方竞彩", "{}", 1),
            )
            self.db.execute(
                statement("INSERT INTO official_odds_transition_history"),
                (market_hash, observed_at, market_hash),
            )
            self.db.execute(statement("INSERT INTO official_odds_transition_head"), (market_hash,))
            self.assertEqual(
                self.db.execute(
                    statement("SELECT snapshot_json, event_count FROM official_odds_snapshot_history"),
                    (market_hash,),
                ).fetchone(), ("{}", 1),
            )
            self.assertEqual(
                self.db.execute(statement("SELECT snapshot_hash FROM official_odds_transition_head")).fetchone()[0],
                market_hash,
            )
            self.assertEqual(
                self.db.execute(statement("SELECT snapshot_hash FROM official_odds_transition_history")).fetchone()[0],
                market_hash,
            )

    def test_aba_retains_three_events_and_two_unique_states(self):
        self.append("A", "2026-10-25T04:30:00Z")
        self.append("B", "2026-10-25T04:31:00Z")
        self.append("A", "2026-10-25T04:32:00Z")
        self.append("A", "2026-10-25T04:33:00Z")
        events = self.db.execute(
            "SELECT snapshot_hash,previous_hash FROM official_odds_transition_history ORDER BY transition_id"
        ).fetchall()
        self.assertEqual(events, [("A", None), ("B", "A"), ("A", "B")])
        self.assertEqual(self.db.execute("SELECT count(*) FROM official_odds_snapshot_history").fetchone()[0], 2)

    def test_transition_error_rolls_back_new_state_and_head(self):
        self.append("A", "2026-10-25T04:30:00Z")
        self.db.execute("""CREATE TRIGGER reject_transition BEFORE INSERT ON official_odds_transition_history
                           BEGIN SELECT RAISE(ABORT, 'injected failure'); END""")
        with self.assertRaises(sqlite3.DatabaseError):
            self.append("B", "2026-10-25T04:31:00Z")
        self.assertEqual(self.db.execute("SELECT count(*) FROM official_odds_snapshot_history").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM official_odds_transition_history").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT snapshot_hash FROM official_odds_transition_head").fetchone()[0], "A")


if __name__ == "__main__":
    unittest.main()
