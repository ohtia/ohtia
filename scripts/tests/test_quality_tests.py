"""Exercise mandatory-case accounting independently of unittest's exit semantics."""

from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_tests


class MandatoryAccountingTests(unittest.TestCase):
    def run_case(self, method):
        case_type = type("SyntheticCase", (unittest.TestCase,), {"runTest": method})
        return unittest.TextTestRunner(
            stream=io.StringIO(), resultclass=quality_tests.AccountedResult
        ).run(unittest.TestSuite([case_type()]))

    def test_success_is_explicitly_accounted(self):
        result = self.run_case(lambda case: case.assertEqual(2 + 2, 4))
        self.assertEqual(list(result.outcomes.values()), ["passed"])

    def test_skips_cannot_become_mandatory_success(self):
        result = self.run_case(lambda case: case.skipTest("Synthetic unavailable fixture"))
        self.assertTrue(result.wasSuccessful())
        self.assertEqual(list(result.outcomes.values()), ["skipped"])

    def test_expected_failure_cannot_become_mandatory_success(self):
        @unittest.expectedFailure
        def failure(case):
            case.fail("Synthetic expected failure")

        result = self.run_case(failure)
        self.assertTrue(result.wasSuccessful())
        self.assertEqual(list(result.outcomes.values()), ["expected-failure"])

    def test_subtest_failure_marks_its_parent_case(self):
        def failure(case):
            with case.subTest("Synthetic branch"):
                case.fail("Synthetic failure")

        result = self.run_case(failure)
        self.assertEqual(list(result.outcomes.values()), ["failed"])

    def test_nested_discovery_preserves_every_case(self):
        case = unittest.FunctionTestCase(lambda: None)
        self.assertEqual(
            quality_tests.flatten(unittest.TestSuite([unittest.TestSuite([case])])), [case]
        )


if __name__ == "__main__":
    unittest.main()
