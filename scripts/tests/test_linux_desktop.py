"""Contracts for Linux desktop identity, naming and KDE package selection."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import linux_desktop as desktop

KDE_SESSION = {
    "XDG_CURRENT_DESKTOP": "KDE",
    "XDG_SESSION_TYPE": "wayland",
    "KDE_SESSION_VERSION": "6",
}
GNOME_SESSION = {"XDG_CURRENT_DESKTOP": "GNOME", "XDG_SESSION_TYPE": "wayland"}
RELEASES = {
    "ubuntu-26.04": {"ID": "ubuntu", "VERSION_ID": "26.04"},
    "debian-13": {"ID": "debian", "VERSION_ID": "13"},
    "fedora-44": {"ID": "fedora", "VERSION_ID": "44"},
}


def installed(*names):
    return lambda name: name in names


class LinuxDesktopTests(unittest.TestCase):
    def errors(self, profile, selected, release=None, env=None, packages=()):
        return desktop.identity_errors(
            profile,
            selected,
            {**RELEASES[profile], **(release or {})},
            env if env is not None else (KDE_SESSION if selected == "kde" else GNOME_SESSION),
            installed(*packages),
        )

    def test_official_kde_identity_of_each_distribution_is_admitted(self):
        for profile, package in desktop.KDE_IDENTITY.items():
            with self.subTest(profile=profile):
                release = {"VARIANT_ID": "kde"} if profile == "fedora-44" else {}
                self.assertEqual(self.errors(profile, "kde", release, packages=[package]), [])

    def test_gnome_identity_of_each_distribution_is_admitted(self):
        for profile in desktop.PROFILES:
            with self.subTest(profile=profile):
                release = {"VARIANT_ID": "workstation"} if profile == "fedora-44" else {}
                self.assertEqual(
                    self.errors(profile, "gnome", release, packages=["gnome-shell"]), []
                )

    def test_cross_identities_and_mixed_desktops_are_refused(self):
        kde_fedora = ["fedora-release-identity-kde-desktop"]
        cases = (
            (
                "Fedora KDE identity in a GNOME cell",
                "fedora-44",
                "gnome",
                {"VARIANT_ID": "kde"},
                None,
                ["gnome-shell", *kde_fedora],
            ),
            (
                "Workstation identity in a KDE cell",
                "fedora-44",
                "kde",
                {"VARIANT_ID": "workstation"},
                None,
                kde_fedora,
            ),
            (
                "gnome-shell installed in a KDE cell",
                "ubuntu-26.04",
                "kde",
                {},
                None,
                ["kubuntu-desktop", "gnome-shell"],
            ),
            ("missing Kubuntu identity", "ubuntu-26.04", "kde", {}, None, []),
            (
                "Kubuntu identity in a GNOME cell",
                "ubuntu-26.04",
                "gnome",
                {},
                None,
                ["gnome-shell", "kubuntu-desktop"],
            ),
            ("missing gnome-shell in a GNOME cell", "debian-13", "gnome", {}, None, []),
            (
                "X11 session on Debian 13 KDE",
                "debian-13",
                "kde",
                {},
                {**KDE_SESSION, "XDG_SESSION_TYPE": "x11", "DISPLAY": ":0"},
                ["task-kde-desktop"],
            ),
            (
                "X11 DISPLAY beside Wayland",
                "debian-13",
                "kde",
                {},
                {**KDE_SESSION, "DISPLAY": ":0"},
                ["task-kde-desktop"],
            ),
            (
                "missing KDE_SESSION_VERSION",
                "debian-13",
                "kde",
                {},
                {k: v for k, v in KDE_SESSION.items() if k != "KDE_SESSION_VERSION"},
                ["task-kde-desktop"],
            ),
            (
                "KDE_SESSION_VERSION=5",
                "debian-13",
                "kde",
                {},
                {**KDE_SESSION, "KDE_SESSION_VERSION": "5"},
                ["task-kde-desktop"],
            ),
            (
                "GNOME session in a KDE cell",
                "debian-13",
                "kde",
                {},
                {**KDE_SESSION, "XDG_CURRENT_DESKTOP": "GNOME"},
                ["task-kde-desktop"],
            ),
            ("KDE session in a GNOME cell", "debian-13", "gnome", {}, KDE_SESSION, ["gnome-shell"]),
        )
        for label, profile, selected, release, env, packages in cases:
            with self.subTest(label=label):
                self.assertTrue(self.errors(profile, selected, release, env, packages))
        self.assertEqual(
            desktop.identity_errors("debian-13", "xfce", {}, {}, installed()),
            ["Unknown Linux desktop."],
        )

    def test_cell_identifiers_follow_target_profile_and_linux_desktop(self):
        self.assertEqual(
            desktop.cell_id("linux-arm64", "ubuntu-26.04", "kde"), "linux-arm64-ubuntu-26-04-kde"
        )
        self.assertEqual(
            desktop.cell_id("win32-x64", "windows-server-2025"), "win32-x64-windows-server-2025"
        )
        self.assertEqual(desktop.cell_id("darwin-arm64", "macos-27"), "darwin-arm64-macos-27")
        for target, profile, selected in (
            ("linux-x64", "fedora-44", None),
            ("linux-x64", "fedora-44", "xfce"),
            ("win32-x64", "windows-11", "gnome"),
            ("linux-x64", "Fedora 44", "kde"),
        ):
            with self.subTest(target=target, profile=profile, desktop=selected):
                with self.assertRaises(desktop.DesktopError):
                    desktop.cell_id(target, profile, selected)

    def test_kde_packages_replace_gnome_session_and_add_explicit_set(self):
        gnome = ["python3", "gnome-shell", "gnome-session", "xdg-utils", "libgtk-3-0t64"]
        packages = desktop.kde_packages("debian-13", gnome)
        self.assertNotIn("gnome-shell", packages)
        self.assertNotIn("gnome-session", packages)
        self.assertEqual(packages[:3], ["python3", "xdg-utils", "libgtk-3-0t64"])
        for name in desktop.KDE_EXPLICIT["apt-get"]:
            self.assertIn(name, packages)
        self.assertEqual(len(packages), len(set(packages)))
        fedora = desktop.kde_packages("fedora-44", ["gtk3", "gnome-shell"])
        self.assertIn("breeze-gtk-gtk3", fedora)
        self.assertIn("kde-gtk-config", fedora)

    def test_kde_installation_has_no_recommended_or_weak_dependencies(self):
        apt = desktop.kde_install_commands("ubuntu-26.04", ["gnome-shell", "python3"])
        self.assertEqual(len(apt), 1)
        self.assertIn("--no-install-recommends", apt[0])
        self.assertIn("DEBIAN_FRONTEND=noninteractive", apt[0])
        self.assertIn("kubuntu-desktop", apt[0])
        self.assertNotIn("gnome-shell", apt[0])
        dnf = desktop.kde_install_commands("fedora-44", ["gtk3"])
        self.assertEqual(
            dnf[0],
            ["dnf", "-y", "install", "--allowerasing", "fedora-release-identity-kde-desktop"],
        )
        self.assertIn("--setopt=install_weak_deps=False", dnf[1])
        self.assertIn("@kde-desktop", dnf[1])
        with self.assertRaises(desktop.DesktopError):
            desktop.kde_install_commands("arch-rolling", [])

    def test_contributor_desktop_detection_refuses_mixtures_and_other_editions(self):
        with patch.object(
            desktop, "package_installed", side_effect=lambda p, n: n == "kubuntu-desktop"
        ):
            self.assertEqual(
                desktop.detect_desktop("ubuntu-26.04", RELEASES["ubuntu-26.04"]), "kde"
            )
        with patch.object(
            desktop, "package_installed", side_effect=lambda p, n: n == "gnome-shell"
        ):
            self.assertEqual(desktop.detect_desktop("debian-13", RELEASES["debian-13"]), "gnome")
        for names in ((), ("gnome-shell", "task-kde-desktop")):
            with (
                self.subTest(names=names),
                patch.object(desktop, "package_installed", side_effect=lambda p, n: n in names),
                self.assertRaises(desktop.DesktopError),
            ):
                desktop.detect_desktop("debian-13", RELEASES["debian-13"])
        identity = "fedora-release-identity-kde-desktop"
        for variant, names, expected in (
            ("kde", {identity}, "kde"),
            ("workstation", {"gnome-shell"}, "gnome"),
            ("workstation", set(), None),
            ("kde", {identity, "gnome-shell"}, None),
            ("kde", set(), None),
            ("workstation", {"gnome-shell", identity}, None),
            ("silverblue", {"gnome-shell"}, None),
        ):
            with (
                self.subTest(variant=variant, names=names),
                patch.object(desktop, "package_installed", side_effect=lambda p, n: n in names),
            ):
                if expected is None:
                    with self.assertRaises(desktop.DesktopError):
                        desktop.detect_desktop("fedora-44", {"VARIANT_ID": variant})
                else:
                    self.assertEqual(
                        desktop.detect_desktop("fedora-44", {"VARIANT_ID": variant}), expected
                    )

    def test_chromium_desktop_classification_matches_xdg_util(self):
        self.assertEqual(desktop.chromium_desktop({"XDG_CURRENT_DESKTOP": "ubuntu:GNOME"}), "GNOME")
        self.assertEqual(
            desktop.chromium_desktop({"XDG_CURRENT_DESKTOP": "KDE", "KDE_SESSION_VERSION": "6"}),
            "KDE6",
        )
        self.assertEqual(
            desktop.chromium_desktop({"XDG_CURRENT_DESKTOP": "KDE", "KDE_SESSION_VERSION": "5"}),
            "KDE5",
        )
        self.assertEqual(desktop.chromium_desktop({"XDG_CURRENT_DESKTOP": "KDE"}), "KDE4")
        self.assertEqual(desktop.chromium_desktop({}), "OTHER")

    def test_running_display_managers_are_found_by_executable_or_truncated_comm(self):
        with tempfile.TemporaryDirectory() as temporary:
            proc = Path(temporary)
            for pid, comm, argv0 in (
                (10, "sddm", b"/usr/bin/sddm"),
                (11, "kwin_wayland", b"/usr/bin/kwin_wayland"),
                (12, "gdm-session-wor", b""),
                (13, "plasmalogin", b"/usr/bin/plasmalogin"),
                (14, "renamed", b"/usr/sbin/lightdm"),
            ):
                (proc / str(pid)).mkdir()
                (proc / str(pid) / "comm").write_text(comm + "\n")
                (proc / str(pid) / "cmdline").write_bytes(argv0 + b"\0--flag\0")
            (proc / "self").mkdir()
            (proc / "15").mkdir()
            self.assertEqual(
                desktop.running_display_managers(proc),
                ["gdm-session-worker", "lightdm", "plasmalogin", "sddm"],
            )

    def test_process_environment_is_read_from_the_process_itself(self):
        environment = desktop.process_environment(os.getpid())
        self.assertEqual(environment.get("PATH"), os.environ.get("PATH"))


if __name__ == "__main__":
    unittest.main()
