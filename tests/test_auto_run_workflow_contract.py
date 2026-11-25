import unittest
from pathlib import Path


WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "auto_run.yml"


def event_block(source: str, name: str) -> str:
    lines = source.splitlines()
    start = next((i for i, line in enumerate(lines) if line == f"  {name}:"), None)
    if start is None:
        raise AssertionError(f"Missing workflow event block: {name}")
    end = next(
        (i for i in range(start + 1, len(lines))
         if lines[i].startswith("  ") and not lines[i].startswith("    ") and lines[i].rstrip().endswith(":")),
        len(lines),
    )
    return "\n".join(lines[start + 1:end])


class AutoRunWorkflowContractTests(unittest.TestCase):
    def test_manual_dispatch_never_accepts_credentials_as_plain_inputs(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        dispatch = event_block(source, "workflow_dispatch")
        self.assertNotIn("SITES_SERVICE_TOKEN:", dispatch)
        self.assertNotIn("API_KEY:", dispatch)

    def test_reusable_workflow_declares_credentials_as_optional_secrets(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        reusable = event_block(source, "workflow_call")
        self.assertIn("    secrets:", reusable)
        self.assertIn("      SITES_SERVICE_TOKEN:\n        required: false", reusable)
        self.assertIn("      API_KEY:\n        required: false", reusable)


if __name__ == "__main__":
    unittest.main()
