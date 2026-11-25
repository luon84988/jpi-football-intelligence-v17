import re
import unittest
from pathlib import Path


WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "auto_run.yml"


def event_block(source: str, name: str) -> str:
    pattern = rf"(?ms)^  {re.escape(name)}:\\n(.*?)(?=^  [A-Za-z_][A-Za-z0-9_-]*:\\s*$|\\Z)"
    match = re.search(pattern, source)
    if not match:
        raise AssertionError(f"Missing workflow event block: {name}")
    return match.group(1)


class AutoRunWorkflowContractTests(unittest.TestCase):
    def test_manual_dispatch_never_accepts_credentials_as_plain_inputs(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        dispatch = event_block(source, "workflow_dispatch")
        self.assertNotRegex(dispatch, r"(?m)^\\s+(?:SITES_SERVICE_TOKEN|API_KEY):")

    def test_reusable_workflow_declares_credentials_as_optional_secrets(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        reusable = event_block(source, "workflow_call")
        self.assertRegex(reusable, r"(?m)^    secrets:\\s*$")
        self.assertRegex(reusable, r"(?m)^      SITES_SERVICE_TOKEN:\\n        required: false\\s*$")
        self.assertRegex(reusable, r"(?m)^      API_KEY:\\n        required: false\\s*$")


if __name__ == "__main__":
    unittest.main()
