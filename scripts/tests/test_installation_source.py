"""Package source selection accepts integrated main history without signature policy."""

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from installation_attestor import API, Network
from installation_source import resolve_source


class SourceSelectionTests(unittest.TestCase):
    source = "a" * 40
    main = "b" * 40
    tree = "c" * 40

    def network(self, status="ahead"):
        return Mock(
            api=Mock(
                side_effect=[
                    {
                        "sha": self.source,
                        "tree": {"sha": self.tree},
                        "verification": {"verified": False},
                    },
                    {
                        "status": status,
                        "base_commit": {"sha": self.source},
                        "merge_base_commit": {"sha": self.source},
                    },
                ]
            )
        )

    def test_empty_hash_fixes_main_without_signature_or_history_queries(self):
        network = self.network()
        result = resolve_source("", self.source, network)
        self.assertEqual(
            result,
            {"source_commit": self.source, "source_tree": self.tree, "main_commit": self.source},
        )
        network.api.assert_called_once_with(f"/git/commits/{self.source}")

    def test_explicit_hash_uses_exact_older_integrated_source(self):
        network = self.network()
        result = resolve_source(self.source, self.main, network)
        self.assertEqual(result["source_commit"], self.source)
        self.assertEqual(
            network.api.call_args.args, (f"/compare/{self.source}...{self.main}?per_page=1&page=2",)
        )

    def test_explicit_hash_passes_the_real_client_path_guard(self):
        network = Network({"GITHUB_TOKEN": "synthetic"})
        records = self.network().api.side_effect
        with patch.object(network, "metadata", side_effect=records) as read:
            result = resolve_source(self.source, self.main, network)
        self.assertEqual(result["source_commit"], self.source)
        self.assertEqual(
            read.call_args.args, (f"{API}/compare/{self.source}...{self.main}?per_page=1&page=2",)
        )
        for path in (
            "/../commits/main",
            "/compare/../../main",
            f"/compare/{self.source}...main",
            f"/compare/{self.source}...{self.main}?per_page=1&page=2/../x",
        ):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "api_path"):
                network.api(path)

    def test_invalid_hashes_and_branch_names_are_refused_before_network(self):
        for value in ("main", "a" * 39, "../main", "a" * 40 + "\nmalicious"):
            with self.subTest(value=value):
                network = self.network()
                with self.assertRaisesRegex(ValueError, "source_hash"):
                    resolve_source(value, self.main, network)
                network.api.assert_not_called()

    def test_unintegrated_and_divergent_sources_are_refused(self):
        for status in ("behind", "diverged", "identical"):
            with (
                self.subTest(status=status),
                self.assertRaisesRegex(ValueError, "source_not_in_main"),
            ):
                resolve_source(self.source, self.main, self.network(status))

    def test_wrong_commit_or_missing_tree_is_refused(self):
        for value in (
            None,
            [],
            {"sha": self.main, "tree": {"sha": self.tree}},
            {"sha": self.source},
            {"sha": self.source, "tree": None},
        ):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "source_commit"):
                resolve_source(self.source, self.main, Mock(api=Mock(return_value=value)))

    def test_comparison_must_prove_selected_commit_is_an_ancestor(self):
        network = self.network()
        network.api.side_effect = [
            {"sha": self.source, "tree": {"sha": self.tree}},
            {
                "status": "ahead",
                "base_commit": {"sha": self.source},
                "merge_base_commit": {"sha": self.main},
            },
        ]
        with self.assertRaisesRegex(ValueError, "source_not_in_main"):
            resolve_source(self.source, self.main, network)


if __name__ == "__main__":
    unittest.main()
