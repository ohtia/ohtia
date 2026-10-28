"""Account for every required repository test (Python >=3.12)."""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from typing import Any, override

ROOT = Path(__file__).resolve().parents[1]


def flatten(suite: unittest.TestSuite) -> list[unittest.TestCase]:
    """Expand discovery without relying on process exit or summary prose."""
    cases: list[unittest.TestCase] = []
    for child in suite:
        if isinstance(child, unittest.TestSuite):
            cases.extend(flatten(child))
        elif isinstance(child, unittest.TestCase):
            cases.append(child)
        else:
            raise ValueError("Invalid repository test inventory entry")
    return cases


class AccountedResult(unittest.TextTestResult):
    """Retain unmet mandatory cases, including subtest failures."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.outcomes: dict[str, str] = {}

    @override
    def startTest(self, test: unittest.TestCase) -> None:
        self.outcomes[test.id()] = "pending"
        super().startTest(test)

    @override
    def addSuccess(self, test: unittest.TestCase) -> None:
        self.outcomes[test.id()] = "passed"
        super().addSuccess(test)

    @override
    def addFailure(self, test: unittest.TestCase, err: Any) -> None:
        self.outcomes[test.id()] = "failed"
        super().addFailure(test, err)

    @override
    def addError(self, test: unittest.TestCase, err: Any) -> None:
        self.outcomes[test.id()] = "failed"
        super().addError(test, err)

    @override
    def addSkip(self, test: unittest.TestCase, reason: str) -> None:
        self.outcomes[test.id()] = "skipped"
        super().addSkip(test, reason)

    @override
    def addExpectedFailure(self, test: unittest.TestCase, err: Any) -> None:
        self.outcomes[test.id()] = "expected-failure"
        super().addExpectedFailure(test, err)

    @override
    def addUnexpectedSuccess(self, test: unittest.TestCase) -> None:
        self.outcomes[test.id()] = "unexpected-success"
        super().addUnexpectedSuccess(test)

    @override
    def addSubTest(self, test: unittest.TestCase, subtest: unittest.TestCase, err: Any) -> None:
        if err is not None:
            self.outcomes[test.id()] = "failed"
        super().addSubTest(test, subtest, err)


def main() -> int:
    listing = sys.argv[1:] == ["--list"]
    output = ROOT / (
        ".reports/quality/python-inventory.json" if listing else ".reports/quality/python.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    record: dict[str, Any] = {
        "version": 1,
        "shard": "python-1",
        "identity": json.loads(os.environ.get("OHTIA_QUALITY_IDENTITY", "null")),
        "preparation": "failed",
        "status": "failed",
        "cases": [],
    }
    output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    try:
        inventory = json.loads((ROOT / "config/quality/inventory.json").read_text())
        files = sorted(
            file.relative_to(ROOT).as_posix() for file in (ROOT / "scripts/tests").glob("test_*.py")
        )
        if files != sorted(inventory["python"]):
            raise ValueError("Repository Python file inventory differs")
        loader = unittest.TestLoader()
        cases = flatten(loader.discover(str(ROOT / "scripts/tests")))
        identifiers = [case.id() for case in cases]
        if loader.errors or not identifiers or len(set(identifiers)) != len(identifiers):
            raise ValueError("Invalid or incomplete repository Python case inventory")
        exclusions = inventory["python_inapplicable"]
        if len({item["id"] for item in exclusions}) != len(exclusions) or any(
            item["id"] not in identifiers
            or not item["platforms"]
            or not set(item["platforms"]) <= {"win32", "darwin", "linux"}
            or not item["reason"]
            for item in exclusions
        ):
            raise ValueError("Unknown repository Python applicability identifier")
        excluded = {item["id"] for item in exclusions if sys.platform in item["platforms"]}
        required = [case for case in cases if case.id() not in excluded]
        expected = [case.id() for case in required]
        record["discovered"] = identifiers
        record["required"] = expected
        record["inapplicable"] = [item for item in exclusions if item["id"] in excluded]
        record["preparation"] = "passed"
        if listing:
            record["status"] = "inventory"
            return 0
        result = unittest.TextTestRunner(verbosity=2, resultclass=AccountedResult).run(
            unittest.TestSuite(required)
        )
        if not isinstance(result, AccountedResult):
            raise ValueError("Invalid repository Python result type")
        record["cases"] = [
            {"id": key, "status": value, "attempts": 1, "expectedFailure": False}
            for key, value in result.outcomes.items()
        ]
        if (
            expected
            and set(result.outcomes) == set(expected)
            and all(value == "passed" for value in result.outcomes.values())
            and result.wasSuccessful()
        ):
            record["status"] = "passed"
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Repository test accounting failed: {error}", file=sys.stderr)
    finally:
        output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return 0 if record["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
