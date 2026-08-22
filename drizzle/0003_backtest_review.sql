CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  scope_from TEXT,
  scope_to TEXT,
  filters_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
  sample_size INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backtest_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  run_id TEXT NOT NULL,
  prediction_id INTEGER,
  outcome_id INTEGER,
  match_id TEXT NOT NULL,
  league TEXT,
  kickoff_at TEXT,
  analysis_status TEXT NOT NULL,
  data_quality_grade TEXT,
  risk_grade TEXT,
  predicted_result TEXT,
  predicted_handicap TEXT,
  predicted_total TEXT,
  predicted_scores_json TEXT NOT NULL DEFAULT '[]',
  model_probabilities_json TEXT NOT NULL DEFAULT '{}',
  main_evidence_json TEXT NOT NULL DEFAULT '[]',
  counter_evidence_json TEXT NOT NULL DEFAULT '[]',
  risk_evidence_json TEXT NOT NULL DEFAULT '[]',
  actual_home_goals INTEGER,
  actual_away_goals INTEGER,
  actual_result TEXT,
  result_hit INTEGER,
  handicap_hit INTEGER,
  total_hit INTEGER,
  score_distance REAL,
  brier_score REAL,
  log_loss REAL,
  pnl_units REAL,
  error_category TEXT,
  error_details_json TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','settled','reviewed','excluded')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(prediction_id) REFERENCES analysis_predictions(id),
  FOREIGN KEY(outcome_id) REFERENCES analysis_outcomes(id),
  UNIQUE(run_id, match_id)
);

CREATE TABLE IF NOT EXISTS backtest_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  run_id TEXT NOT NULL,
  dimension_type TEXT NOT NULL,
  dimension_value TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  result_hit_rate REAL,
  handicap_hit_rate REAL,
  total_hit_rate REAL,
  exact_score_hit_rate REAL,
  average_score_distance REAL,
  brier_score REAL,
  log_loss REAL,
  roi REAL,
  max_drawdown REAL,
  calibration_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE,
  UNIQUE(run_id, dimension_type, dimension_value)
);

CREATE TABLE IF NOT EXISTS learning_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  run_id TEXT NOT NULL,
  case_id INTEGER,
  rule_code TEXT NOT NULL,
  error_category TEXT NOT NULL,
  old_value_json TEXT NOT NULL DEFAULT '{}',
  proposed_value_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected','applied','reverted')),
  approved_by TEXT,
  approved_at TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(case_id) REFERENCES backtest_cases(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS backtest_runs_model_idx ON backtest_runs(model_version, status);
CREATE INDEX IF NOT EXISTS backtest_cases_match_idx ON backtest_cases(match_id);
CREATE INDEX IF NOT EXISTS backtest_cases_quality_idx ON backtest_cases(data_quality_grade, risk_grade);
CREATE INDEX IF NOT EXISTS backtest_cases_league_idx ON backtest_cases(league, kickoff_at);
CREATE INDEX IF NOT EXISTS backtest_cases_error_idx ON backtest_cases(error_category, review_status);
CREATE INDEX IF NOT EXISTS backtest_metrics_dimension_idx ON backtest_metrics(dimension_type, dimension_value);
CREATE INDEX IF NOT EXISTS learning_updates_rule_idx ON learning_updates(rule_code, status);
