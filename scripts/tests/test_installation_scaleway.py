"""Exercise main-only admission, GET transport bounds and truthful cloud evidence."""

from __future__ import annotations

import contextlib
import copy
import http.client
import io
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installation_scaleway as scaleway

PROJECT = "11111111-1111-4111-8111-111111111111"
FEDORA = "22222222-2222-4222-8222-222222222222"
DEBIAN = "33333333-3333-4333-8333-333333333333"
SHA = "a" * 40
TOKEN = "synthetic-private-credential-marker"
ENVIRONMENT = {
    "GITHUB_ACTIONS": "true",
    "RUNNER_ENVIRONMENT": "github-hosted",
    "RUNNER_OS": "Linux",
    "RUNNER_ARCH": "X64",
    "GITHUB_REPOSITORY": "ohtia/ohtia",
    "GITHUB_EVENT_NAME": "workflow_dispatch",
    "GITHUB_REF": "refs/heads/main",
    "GITHUB_WORKFLOW_REF": scaleway.WORKFLOW,
    "GITHUB_WORKFLOW_SHA": SHA,
    "GITHUB_SHA": SHA,
    "GITHUB_RUN_ID": "12345",
    "GITHUB_RUN_ATTEMPT": "2",
    "SCW_PROJECT_ID": PROJECT,
    "SCW_ARM_ZONE": "nl-ams-1",
    "SCW_ARM_INSTANCE_TYPE": "BASIC2-A8C-32G",
    "SCW_ARM_DISK_GB": "32",
    "SCW_ARM_FEDORA44_IMAGE_ID": FEDORA,
    "SCW_ARM_DEBIAN13_IMAGE_ID": DEBIAN,
    "SCW_SECRET_KEY": TOKEN,
    "PATH": "/usr/bin:/bin",
}


class ScalewayTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, ENVIRONMENT, clear=True))
        self.enterContext(patch.object(scaleway.platform, "system", return_value="Linux"))
        self.enterContext(patch.object(scaleway.platform, "machine", return_value="x86_64"))
        self.git = self.enterContext(
            patch.object(subprocess, "run", return_value=SimpleNamespace(stdout=SHA + "\n"))
        )
        self.settings = scaleway.configuration()
        self.catalog = {
            "servers": {
                "BASIC2-A8C-32G": {
                    "arch": "arm64",
                    "end_of_service": False,
                    "capabilities": {"block_storage": True},
                    # Catalog price placeholders are never evidence of a free machine.
                    "hourly_price": 0,
                }
            }
        }
        self.images = [
            {
                "id": image,
                "label": label,
                "arch": "arm64",
                "zone": "nl-ams-1",
                "type": "instance_sbs",
                "compatible_commercial_types": ["BASIC2-A8C-32G"],
            }
            for label, image in [("fedora_44", FEDORA), ("debian_trixie", DEBIAN)]
        ]

    def connection(self, body=b'{"ok":true}', status=200, encoding="identity"):
        response = Mock(status=status, length=None)
        response.getheader.return_value = encoding
        stream = io.BytesIO(body)
        response.read1.side_effect = stream.read1
        connection = Mock()
        connection.getresponse.return_value = response
        factory = self.enterContext(
            patch.object(http.client, "HTTPSConnection", return_value=connection)
        )
        return factory, connection, response

    def test_context_binds_dispatch_main_workflow_commit_and_attempt(self):
        identity = scaleway.context()
        self.assertEqual(identity["source_sha"], SHA)
        self.assertEqual(identity["attempt"], "2")
        self.assertEqual(self.git.call_args.args[0], ["git", "rev-parse", "HEAD"])
        self.assertEqual(self.git.call_args.kwargs["timeout"], 5)
        self.assertEqual(
            self.git.call_args.kwargs["env"],
            {"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
        )
        invalid = {
            "GITHUB_ACTIONS": "false",
            "RUNNER_ENVIRONMENT": "self-hosted",
            "RUNNER_ARCH": "ARM64",
            "GITHUB_EVENT_NAME": "pull_request_target",
            "GITHUB_REPOSITORY": "attacker/ohtia",
            "GITHUB_REF": "refs/heads/other",
            "GITHUB_WORKFLOW_REF": scaleway.WORKFLOW.replace(
                "@refs/heads/main", "@refs/heads/other"
            ),
            "GITHUB_WORKFLOW_SHA": "b" * 40,
            "GITHUB_SHA": "not-a-sha",
            "GITHUB_RUN_ID": "0",
            "GITHUB_RUN_ATTEMPT": "2\n",
        }
        for key, value in invalid.items():
            with (
                self.subTest(key=key),
                patch.dict(os.environ, {key: value}),
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.context()
        self.git.return_value.stdout = "b" * 40
        with self.assertRaisesRegex(scaleway.PreflightError, "checkout_source_mismatch"):
            scaleway.context()
        self.git.return_value.stdout = SHA
        with (
            patch.object(scaleway.platform, "machine", return_value="aarch64"),
            self.assertRaisesRegex(scaleway.PreflightError, "wrong_runner"),
        ):
            scaleway.context()

    def test_local_or_missing_credentials_never_contact_the_provider(self):
        for changes in [{"GITHUB_ACTIONS": "false"}, {"SCW_SECRET_KEY": ""}]:
            with (
                patch.dict(os.environ, changes),
                patch.object(scaleway, "get") as get,
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.observe()
            get.assert_not_called()

    def test_configuration_cannot_inject_paths_or_duplicate_images(self):
        invalid = {
            "SCW_PROJECT_ID": "../other-project",
            "SCW_ARM_ZONE": "nl-ams-1/../../evil",
            "SCW_ARM_INSTANCE_TYPE": "ARM\nInjected: value",
            "SCW_ARM_DISK_GB": "0",
            "SCW_ARM_FEDORA44_IMAGE_ID": "https://attacker.example",
            "SCW_ARM_DEBIAN13_IMAGE_ID": FEDORA,
        }
        for key, value in invalid.items():
            with (
                self.subTest(key=key),
                patch.dict(os.environ, {key: value}),
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.configuration()
        for invalid_uuid in [
            None,
            "",
            "0" * 32,
            "00000000-0000-0000-0000-000000000000",
            FEDORA.upper() + "/x",
        ]:
            with self.assertRaises(scaleway.PreflightError):
                scaleway.canonical_uuid(invalid_uuid)

    def test_transport_uses_get_fixed_tls_origin_and_no_ambient_proxy(self):
        factory, connection, _ = self.connection()
        with patch.dict(os.environ, {"HTTPS_PROXY": "https://attacker.example"}):
            self.assertEqual(
                scaleway.get("/instance/v1/zones/nl-ams-1/servers", token=TOKEN), {"ok": True}
            )
        factory.assert_called_once_with("api.scaleway.com", timeout=scaleway.REQUEST_SECONDS)
        args, options = connection.request.call_args
        self.assertEqual(args, ("GET", "/instance/v1/zones/nl-ams-1/servers"))
        self.assertEqual(options["headers"]["X-Auth-Token"], TOKEN)
        self.assertNotIn("body", options)
        connection.close.assert_called_once()

    def test_redirects_and_api_errors_are_not_followed_or_read(self):
        for status in [301, 302, 307, 308, 401, 403, 429, 500]:
            with self.subTest(status=status):
                factory, connection, response = self.connection(status=status)
                with self.assertRaisesRegex(
                    scaleway.PreflightError,
                    {
                        401: "^api_unauthorized$",
                        403: "^api_forbidden$",
                        429: "^api_rate_limited$",
                    }.get(status, "^api_request_refused$"),
                ):
                    scaleway.get("/block/v1/zones/nl-ams-1/volumes", token=TOKEN)
                factory.assert_called_once()
                response.read1.assert_not_called()
                connection.close.assert_called_once()

    def test_arbitrary_origins_and_header_injection_are_refused_before_connection(self):
        for path in [
            "https://attacker.example/x",
            "//attacker.example/x",
            "/iam/v1alpha1/api-keys",
            "/instance/v1/zones/nl-ams-1/servers\r\nX: y",
        ]:
            with (
                patch.object(http.client, "HTTPSConnection") as connect,
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.get(path, token=TOKEN)
            connect.assert_not_called()
        with (
            patch.object(http.client, "HTTPSConnection") as connect,
            self.assertRaises(scaleway.PreflightError),
        ):
            scaleway.get("/instance/v1/zones/nl-ams-1/servers", token=TOKEN + "\nInjected")
        connect.assert_not_called()

    def test_oversized_encoded_duplicate_and_nonobject_json_fail_closed(self):
        bodies = [b"x" * 65, b'{"a":1,"a":2}', b"[]", b'{"a":NaN}', b"\xff", b'{"unfinished":']
        for body in bodies:
            with self.subTest(body=body[:20]), patch.object(scaleway, "MAXIMUM_RESPONSE_BYTES", 64):
                _, connection, _ = self.connection(body=body)
                with self.assertRaises(scaleway.PreflightError):
                    scaleway.get("/instance/v1/zones/nl-ams-1/servers")
                connection.close.assert_called_once()
        _, _, response = self.connection(encoding="gzip")
        with self.assertRaisesRegex(scaleway.PreflightError, "encoded_response"):
            scaleway.get("/instance/v1/zones/nl-ams-1/servers")
        response.read1.assert_not_called()

    def test_real_http_framing_rejects_premature_eof_even_with_valid_json(self):
        payload = b'{"servers":[]}'
        cases = [
            (b"Content-Length: " + str(len(payload)).encode(), payload, True),
            (b"Content-Length: 100", payload, False),
            (b"Connection: close", payload, True),
            (b"Transfer-Encoding: chunked", b"f\r\n" + payload + b"\r\n0\r\n\r\n", False),
            (b"Transfer-Encoding: chunked", b"e\r\n" + payload + b"\r\n0\r\n\r\n", True),
            (b"Transfer-Encoding: chunked", b"e\r\n" + payload + b"\r\n", False),
        ]
        for header, body, accepted in cases:
            with self.subTest(header=header, accepted=accepted):
                raw = b"HTTP/1.1 200 OK\r\n" + header + b"\r\n\r\n" + body
                response = http.client.HTTPResponse(
                    SimpleNamespace(makefile=lambda _: io.BytesIO(raw))
                )
                response.begin()
                connection = Mock(sock=None)
                connection.getresponse.return_value = response
                with patch.object(http.client, "HTTPSConnection", return_value=connection):
                    if accepted:
                        self.assertEqual(
                            scaleway.get("/instance/v1/zones/nl-ams-1/servers"), {"servers": []}
                        )
                    else:
                        with self.assertRaises(scaleway.PreflightError):
                            scaleway.get("/instance/v1/zones/nl-ams-1/servers")
                connection.close.assert_called_once()
                response.close()

    def test_catalog_pagination_finds_later_sku_and_stops_at_a_finite_bound(self):
        full = {"servers": {f"other-{n}": {} for n in range(scaleway.CATALOG_PAGE_SIZE)}}
        with patch.object(scaleway, "get", side_effect=[full, self.catalog, *self.images]) as get:
            self.assertEqual(scaleway.profile(self.settings)["instance_type"], "BASIC2-A8C-32G")
        self.assertEqual(
            parse_qs(urlsplit(get.call_args_list[0].args[0]).query),
            {"per_page": ["100"], "page": ["1"]},
        )
        self.assertEqual(
            parse_qs(urlsplit(get.call_args_list[1].args[0]).query),
            {"per_page": ["100"], "page": ["2"]},
        )
        with (
            patch.object(scaleway, "get", return_value=full) as get,
            self.assertRaisesRegex(scaleway.PreflightError, "catalog_page_limit"),
        ):
            scaleway.profile(self.settings)
        self.assertEqual(get.call_count, scaleway.MAXIMUM_CATALOG_PAGES)
        with (
            patch.object(scaleway, "get", side_effect=[full, {"servers": {}}]) as get,
            self.assertRaisesRegex(scaleway.PreflightError, "instance_type_unavailable"),
        ):
            scaleway.profile(self.settings)
        self.assertEqual(get.call_count, 2)

    def test_transport_failures_close_connection_without_exposing_error_text(self):
        for error in [TimeoutError(TOKEN), http.client.HTTPException(TOKEN), OSError(TOKEN)]:
            _, connection, _ = self.connection()
            connection.request.side_effect = error
            with self.assertRaises(scaleway.PreflightError) as caught:
                scaleway.get("/instance/v1/zones/nl-ams-1/servers", token=TOKEN)
            self.assertNotIn(TOKEN, str(caught.exception))
            connection.close.assert_called_once()

    def test_request_deadline_refuses_a_slow_response(self):
        _, connection, response = self.connection()
        with patch.object(
            scaleway.time, "monotonic", side_effect=[0, scaleway.REQUEST_SECONDS + 1]
        ):
            with self.assertRaisesRegex(scaleway.PreflightError, "api_deadline_exceeded"):
                scaleway.get("/instance/v1/zones/nl-ams-1/servers")
        response.read1.assert_not_called()
        connection.close.assert_called_once()

    def test_resource_queries_are_project_filtered_and_do_not_publish_inventory(self):
        with patch.object(
            scaleway,
            "get",
            side_effect=[
                {"servers": [{"project": PROJECT, "name": TOKEN}]},
                {"volumes": [{"project_id": PROJECT, "name": TOKEN}]},
            ],
        ) as get:
            result = scaleway.read_access(self.settings, TOKEN)
        self.assertNotIn(TOKEN, json.dumps(result))
        first, second = get.call_args_list
        self.assertEqual(
            parse_qs(urlsplit(first.args[0]).query),
            {"project": [PROJECT], "per_page": ["1"], "page": ["1"]},
        )
        self.assertEqual(
            parse_qs(urlsplit(second.args[0]).query),
            {
                "project_id": [PROJECT],
                "include_deleted": ["false"],
                "page_size": ["1"],
                "page": ["1"],
            },
        )
        self.assertTrue(all(call.kwargs == {"token": TOKEN} for call in get.call_args_list))

    def test_empty_project_passes_read_only_but_malformed_or_foreign_resources_do_not(self):
        with patch.object(scaleway, "get", side_effect=[{"servers": []}, {"volumes": []}]):
            self.assertEqual(
                scaleway.read_access(self.settings, TOKEN)["instances"],
                "authenticated_list_accepted",
            )
        for response in [
            {},
            {"servers": {}},
            {"servers": [None]},
            {"servers": [{"project": DEBIAN}]},
            {"servers": [{"project": PROJECT}] * 2},
        ]:
            with (
                patch.object(scaleway, "get", return_value=response),
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.read_access(self.settings, TOKEN)
        for volumes in [None, [None], [{"project_id": FEDORA}]]:
            with (
                patch.object(scaleway, "get", side_effect=[{"servers": []}, {"volumes": volumes}]),
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.read_access(self.settings, TOKEN)

    def test_public_catalog_checks_send_no_credentials_and_make_no_price_or_stock_claim(self):
        with patch.object(scaleway, "get", side_effect=[self.catalog, *self.images]) as get:
            result = scaleway.profile(self.settings)
        self.assertTrue(all(not call.kwargs for call in get.call_args_list))
        self.assertEqual([image["id"] for image in result["images"]], [FEDORA, DEBIAN])
        self.assertEqual(result["disk_gb"], 32)
        self.assertEqual(result["disk_bytes"], 32_000_000_000)
        self.assertNotIn("price", json.dumps(result))
        self.assertNotIn("stock", json.dumps(result))

    def test_incompatible_expired_or_non_arm_instance_types_are_refused(self):
        for changes in [
            {"arch": "x86_64"},
            {"end_of_service": True},
            {"capabilities": {"block_storage": False}},
            {"capabilities": None},
        ]:
            catalog = copy.deepcopy(self.catalog)
            catalog["servers"]["BASIC2-A8C-32G"].update(changes)
            with (
                patch.object(scaleway, "get", return_value=catalog),
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.profile(self.settings)
        for catalog in [{}, {"servers": []}, {"servers": {}}]:
            with (
                patch.object(scaleway, "get", return_value=catalog),
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.profile(self.settings)

    def test_wrong_os_architecture_zone_snapshot_or_sku_image_cannot_pass(self):
        for changes in [
            {"id": DEBIAN},
            {"label": "fedora_43"},
            {"arch": "x86_64"},
            {"zone": "fr-par-1"},
            {"type": "instance_sbs_snapshot"},
            {"compatible_commercial_types": []},
            {"compatible_commercial_types": "BASIC2-A8C-32G"},
        ]:
            image = self.images[0] | changes
            with (
                patch.object(scaleway, "get", side_effect=[self.catalog, image]),
                self.assertRaises(scaleway.PreflightError),
            ):
                scaleway.profile(self.settings)

    def test_success_does_not_claim_creating_spending_installation_or_iam_isolation(self):
        with patch.object(
            scaleway,
            "get",
            side_effect=[{"servers": []}, {"volumes": []}, self.catalog, *self.images],
        ):
            report = scaleway.observe()
        for key in [
            "resources_created",
            "write_authority_tested",
            "project_policy_isolation_tested",
            "disk_capacity_tested",
            "stock_reserved",
            "distribution_qualified",
        ]:
            self.assertIs(report[key], False)
        serialized = json.dumps(report)
        self.assertNotIn(TOKEN, serialized)
        self.assertNotIn(PROJECT, serialized)
        self.assertLess(len(serialized), scaleway.MAXIMUM_REPORT_BYTES)

    def test_cli_failure_keeps_stdout_empty_and_diagnostics_secret_free(self):
        for error in [
            scaleway.PreflightError(TOKEN),
            OSError(TOKEN),
            ValueError(TOKEN),
            subprocess.CalledProcessError(1, TOKEN),
        ]:
            stdout, stderr = io.StringIO(), io.StringIO()
            with (
                patch.object(scaleway, "observe", side_effect=error),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                self.assertEqual(scaleway.main(), 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertNotIn(TOKEN, stderr.getvalue())
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(
                scaleway, "observe", side_effect=scaleway.PreflightError("api_unauthorized")
            ),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            self.assertEqual(scaleway.main(), 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("api_unauthorized", stderr.getvalue())
        stdout = io.StringIO()
        with (
            patch.object(scaleway, "observe", return_value={"version": 1}),
            contextlib.redirect_stdout(stdout),
        ):
            self.assertEqual(scaleway.main(), 0)
        self.assertEqual(json.loads(stdout.getvalue()), {"version": 1})
        stdout = io.StringIO()
        with (
            patch.object(
                scaleway, "observe", return_value={"oversized": "x" * scaleway.MAXIMUM_REPORT_BYTES}
            ),
            contextlib.redirect_stderr(io.StringIO()),
            contextlib.redirect_stdout(stdout),
        ):
            self.assertEqual(scaleway.main(), 1)
        self.assertEqual(stdout.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
