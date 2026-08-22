import json
import sqlite3
import sys
from pathlib import Path

if len(sys.argv) < 3:
    raise SystemExit("Usage: apply-local-migrations.py <database.sqlite> <migration.sql> [migration.sql ...]")

database = Path(sys.argv[1]).resolve()
migrations = [Path(value).resolve() for value in sys.argv[2:]]
connection = sqlite3.connect(database, timeout=30)
try:
    connection.execute("PRAGMA foreign_keys=ON")
    for migration in migrations:
        connection.executescript(migration.read_text(encoding="utf-8"))
    connection.commit()
    counts = {
        "player_statistics": connection.execute("SELECT COUNT(*) FROM player_statistics").fetchone()[0],
        "unique_players": connection.execute("SELECT COUNT(DISTINCT player_id) FROM player_statistics").fetchone()[0],
        "backtest_runs": connection.execute("SELECT COUNT(*) FROM backtest_runs").fetchone()[0],
        "backtest_cases": connection.execute("SELECT COUNT(*) FROM backtest_cases").fetchone()[0],
    }
    counts["tables"] = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
            "('player_statistics','backtest_runs','backtest_cases','backtest_metrics','learning_updates') ORDER BY name"
        )
    ]
    print(json.dumps(counts, ensure_ascii=False))
finally:
    connection.close()
