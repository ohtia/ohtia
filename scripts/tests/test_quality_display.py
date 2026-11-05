"""Contracts for the hosted display-session launcher; no native session is simulated as passing."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import plasma_session
import quality_display as display


class QualityDisplayTests(unittest.TestCase):
    def test_hosted_display_cells_name_their_desktop(self):
        self.assertEqual(display.cell_desktop("linux-x64-ubuntu-26-04-gnome"), "gnome")
        self.assertEqual(display.cell_desktop("linux-arm64-ubuntu-26-04-kde"), "kde")
        for cell in (
            "linux-x64-fedora-44-kde",
            "win32-x64-windows-server-2025",
            "ubuntu-26-04-x64-wayland",
        ):
            with self.subTest(cell=cell), self.assertRaises(SystemExit):
                display.cell_desktop(cell)

    def test_dispatches_each_desktop_to_its_own_session(self):
        hosted = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted"}
        for cell, chosen in (
            ("linux-x64-ubuntu-26-04-kde", "plasma"),
            ("linux-x64-ubuntu-26-04-gnome", "gnome"),
        ):
            with (
                self.subTest(cell=cell),
                patch.dict(os.environ, hosted),
                patch.object(sys, "argv", ["quality_display.py", cell, "out"]),
                patch.object(display.os, "getuid", return_value=1000),
                patch.object(display, "plasma", return_value=0) as plasma,
                patch.object(display, "gnome", return_value=0) as gnome,
            ):
                self.assertEqual(display.main(), 0)
                (plasma if chosen == "plasma" else gnome).assert_called_once()
                (gnome if chosen == "plasma" else plasma).assert_not_called()

    def test_refuses_outside_a_fresh_unprivileged_hosted_vm(self):
        with (
            patch.dict(os.environ, {"GITHUB_ACTIONS": "", "RUNNER_ENVIRONMENT": ""}),
            patch.object(sys, "argv", ["quality_display.py", "linux-x64-ubuntu-26-04-kde", "o"]),
            self.assertRaises(SystemExit),
        ):
            display.main()

    def test_plasma_failure_fails_the_cell_without_running_the_build(self):
        @plasma_session.contextmanager
        def failing(*args, **kwargs):
            raise plasma_session.PlasmaError("synthetic readiness failure")
            yield

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(display.plasma_session, "session", failing),
            patch.object(display, "quality_build") as build,
        ):
            with self.assertRaisesRegex(SystemExit, "synthetic readiness failure"):
                display.plasma(directory)
        build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
