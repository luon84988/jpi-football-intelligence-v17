from pathlib import Path
import unittest


class FeedRecoveryWorkflowTests(unittest.TestCase):
    def test_failed_scheduled_monitor_reuses_the_serialized_collector(self):
        workflows = Path(__file__).resolve().parents[1] / ".github" / "workflows"
        monitor = (workflows / "production_health.yml").read_text()
        collector = (workflows / "auto_run.yml").read_text()
        recovery = (workflows / "recover_production_feed.yml").read_text()

        monitor_name = monitor.splitlines()[0].removeprefix("name: ")
        self.assertIn(f"workflows: [{monitor_name}]", recovery)
        self.assertIn("types: [completed]", recovery)
        self.assertIn("branches: [main]", recovery)
        self.assertIn("github.event.workflow_run.conclusion == 'failure'", recovery)
        self.assertIn("github.event.workflow_run.event == 'schedule'", recovery)
        self.assertIn("github.event.workflow_run.head_repository.full_name == github.repository", recovery)
        self.assertIn("uses: ./.github/workflows/auto_run.yml", recovery)
        self.assertIn("workflow_call:", collector)
        self.assertIn("group: jpi-observation-publication", collector)
        self.assertNotIn("secrets: inherit", recovery)
        self.assertNotIn("actions/checkout", recovery)
