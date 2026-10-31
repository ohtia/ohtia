// Admit a fresh GitHub-hosted VM; never turn an ordinary local account into a CI fixture.
import fs from "node:fs";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { selectStableTemporaryParent } from "./quality-fixture-paths.mjs";
import {
  nativeProfileHost,
  loadRuntimeProfile,
  verifyStableSentinels,
} from "../packages/main/dist/index.js";
const [operation, file] = process.argv.slice(2);
const cloud = operation === "prepare-cloud" || operation === "retain-cloud";
if (cloud) {
  const guardFile = "/run/ohtia-qualification.json";
  const info = fs.lstatSync(guardFile);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    info.nlink !== 1 ||
    (info.mode & 0o022) !== 0 ||
    info.size > 65536 ||
    fs.realpathSync(guardFile) !== guardFile
  )
    throw new Error("A root-owned disposable guest guard is required.");
  const guard = JSON.parse(fs.readFileSync(guardFile, "utf8"));
  if (
    process.platform !== "linux" ||
    process.arch !== "arm64" ||
    process.getuid?.() === 0 ||
    os.userInfo().username !== "ohtia-quality" ||
    !guard.ready_at_epoch ||
    Date.parse(guard.intent.expires_at) <= Date.now() ||
    guard.intent.identity.run_id !== process.env.GITHUB_RUN_ID ||
    guard.intent.identity.attempt !== process.env.GITHUB_RUN_ATTEMPT ||
    guard.intent.distribution_qualified !== false
  )
    throw new Error("The disposable guest is not admitted for this run.");
} else if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted"
)
  throw new Error("Automatic fixture provisioning requires a fresh GitHub-hosted VM.");
if (operation === "prepare" || operation === "prepare-cloud") {
  const host = nativeProfileHost();
  if (process.getuid?.() === 0) throw new Error("Electron fixtures must run as an ordinary user.");
  const configuration = path.join(host.configurationRoot, "Ohtia");
  if (fs.existsSync(host.researchRoot) || fs.existsSync(configuration))
    throw new Error("Existing Ohtia state is never adopted, removed or replaced by CI.");
  fs.mkdirSync(host.configurationRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(host.researchRoot, { mode: 0o700 });
  const scratch = fs.mkdtempSync(path.join(host.home, ".ohtia-quality-"));
  const stableParent = selectStableTemporaryParent(host, [os.tmpdir(), process.env.RUNNER_TEMP]);
  const stable = fs.realpathSync.native(fs.mkdtempSync(path.join(stableParent, "ohtia-stable-")));
  const stable_roots = {};
  for (const name of ["configuration", "store", "recovery"]) {
    const root = path.join(stable, name);
    fs.mkdirSync(root, { mode: 0o700 });
    const bytes = Buffer.from(`Synthetic quality sentinel ${randomUUID()}\n`);
    fs.writeFileSync(path.join(root, ".ohtia-runtime-sentinel"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    stable_roots[name] = {
      root,
      sentinel_sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const profile = {
    schema_version: 1,
    kind: "independent-native-profile",
    inspected_by: "agent:github-actions",
    username: host.username,
    target: host.target,
    home: host.home,
    configuration_root: host.configurationRoot,
    research_root: host.researchRoot,
    scratch_root: scratch,
    stable_roots,
    manual_checks: Object.fromEntries(
      [
        "independent_account_or_vm",
        "no_emulation",
        "local_owned_unsynchronized_volumes",
        "no_credentials",
        "stable_roots_complete",
        "native_security_and_display",
      ].map((key) => [key, true]),
    ),
  };
  const profileFile = path.join(scratch, "runtime-profile.json");
  fs.writeFileSync(profileFile, JSON.stringify(profile), { flag: "wx", mode: 0o600 });
  // The native run separately observes the actual CPU, filesystem, OS and renderer sandbox.
  verifyStableSentinels(loadRuntimeProfile(profileFile));
  fs.writeFileSync(
    file,
    JSON.stringify({
      profile: profileFile,
      owner: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
    }),
    { flag: "wx", mode: 0o600 },
  );
} else if (operation === "retain" || operation === "retain-cloud") {
  const context = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    context.owner !== process.env.GITHUB_RUN_ID ||
    context.attempt !== process.env.GITHUB_RUN_ATTEMPT
  )
    throw new Error("Fixture belongs to a different run.");
  const profile = loadRuntimeProfile(context.profile);
  verifyStableSentinels(profile);
  const retained = path.join(profile.scratch_root, `retained-${randomUUID()}`);
  fs.mkdirSync(retained, { mode: 0o700 });
  for (const [source, name] of [
    [profile.research_root, "data"],
    [path.join(profile.configuration_root, "Ohtia"), "configuration"],
  ])
    if (fs.existsSync(source)) fs.renameSync(source, path.join(retained, name));
  fs.mkdirSync(profile.research_root, { mode: 0o700 });
} else throw new Error("Unknown hosted fixture operation.");
