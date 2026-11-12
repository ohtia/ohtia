"""Contract checks for the minimal pinned signing image context."""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_signing_image as image


class SigningImageTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(image.MANIFEST.read_bytes())

    def test_actual_manifest_binds_unique_https_debian_artifacts(self):
        image.validate_manifest(self.manifest)

    def test_signer_image_excludes_retired_source_history_tools(self):
        names = [item["file"] for item in self.manifest["packages"]]
        self.assertFalse(
            any(
                name.startswith(
                    (
                        "git_",
                        "git-man_",
                        "openssh-client_",
                        "liberror-perl_",
                        "libbrotli1_",
                        "libcbor0.10_",
                        "libcom-err2_",
                        "libcurl3t64-gnutls_",
                        "libedit2_",
                        "libexpat1_",
                        "libfido2-1_",
                        "libgdbm-compat4t64_",
                        "libgdbm6t64_",
                        "libgssapi-krb5-2_",
                        "libk5crypto3_",
                        "libkeyutils1_",
                        "libkrb5-3_",
                        "libkrb5support0_",
                        "libnghttp2-14_",
                        "libnghttp3-9_",
                        "libngtcp2-16_",
                        "libngtcp2-crypto-gnutls8_",
                        "libperl5.40_",
                        "libpsl5t64_",
                        "librtmp1_",
                        "libssh2-1t64_",
                        "perl_",
                        "perl-modules-5.40_",
                    )
                )
                for name in names
            )
        )
        recipe = (image.ROOT / "tools/installation-signer/Containerfile").read_text()
        self.assertNotIn("/usr/bin/git", recipe)
        self.assertNotIn("ssh-keygen", recipe)

    def test_refuses_escaping_package_paths(self):
        self.manifest["packages"][0]["file"] = "../outside_amd64.deb"
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_refuses_mutable_image_tags(self):
        self.manifest["base_image"] = "docker.io/library/debian:13"
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_refuses_duplicate_packages(self):
        self.manifest["packages"].append(copy.deepcopy(self.manifest["packages"][0]))
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_refuses_non_https_downloads(self):
        self.manifest["packages"][0]["url"] = "http://deb.debian.org/package_amd64.deb"
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_refuses_bad_digest(self):
        self.manifest["packages"][0]["sha256"] = "invalid"
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_preserves_existing_context_without_downloading(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)
            sentinel = destination / "preserved"
            sentinel.write_text("fixture")
            with patch.object(image, "download") as download, self.assertRaises(ValueError):
                image.prepare(destination, destination / "cache")
            download.assert_not_called()
            self.assertEqual(sentinel.read_text(), "fixture")

    def test_refuses_unbound_license_fallback(self):
        self.manifest["license_fallbacks"][0]["sha256"] = "invalid"
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_refuses_duplicate_license_fallback(self):
        self.manifest["license_fallbacks"].append(
            copy.deepcopy(self.manifest["license_fallbacks"][0])
        )
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_refuses_an_unapproved_package_origin(self):
        self.manifest["packages"][0]["url"] = self.manifest["packages"][0]["url"].replace(
            "deb.debian.org", "example.invalid"
        )
        with self.assertRaises(ValueError):
            image.validate_manifest(self.manifest)

    def test_accepts_percent_encoded_native_version_characters(self):
        self.assertTrue(any("%2b" in row["url"].lower() for row in self.manifest["packages"]))
        image.validate_manifest(self.manifest)
