// Offline assembly from deployment metadata and a separately approved public trust policy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, demand, fields, hash, signingLimits } from "./installation-authority.mjs";
import { signingConfigurationHash } from "./installation-signing-admission.mjs";
import {
  signingResourceBindings,
  signingResourceBindingsHash,
} from "./installation-signing-client.mjs";
import { parseJson } from "./quality-core.mjs";

function metadata(file) {
  const entry = fs.lstatSync(file);
  demand(entry.isFile() && !entry.isSymbolicLink());
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  );
  try {
    const info = fs.fstatSync(fd);
    demand(info.isFile() && info.dev === entry.dev && info.ino === entry.ino);
    demand(info.size > 0 && info.size <= signingLimits.request_bytes);
    const buffer = Buffer.alloc(info.size + 1);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    demand(count === info.size);
    return parseJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)));
  } finally {
    fs.closeSync(fd);
  }
}

export function prepareSigningConfiguration(
  fragmentFile,
  policyFile,
  destination,
  callerFile = null,
) {
  const fragment = metadata(fragmentFile);
  fields(fragment, "project_id buckets secret_versions");
  const policy = metadata(policyFile);
  const configuration = { schema_version: 1, ...fragment, policy };
  const configurationHash = signingConfigurationHash(configuration);
  let resourcesHash = null;
  if (callerFile !== null) {
    const resources = signingResourceBindings(metadata(callerFile));
    demand(canonical(resources.buckets).equals(canonical(fragment.buckets)));
    resourcesHash = signingResourceBindingsHash(resources);
  }
  const clientPolicy = { ...policy };
  for (const name of ["schema_version", "enabled", "signing_workflow"]) delete clientPolicy[name];
  const files = {
    "runtime.json": canonical(configuration),
    "client-template.json": canonical({
      schema_version: 1,
      enabled: false,
      service_origin: null,
      buckets: null,
      resource_bindings_sha256: resourcesHash,
      policy: clientPolicy,
    }),
  };
  files["plan.json"] = canonical({
    schema_version: 1,
    mode: "offline-preview",
    requires_independent_approval: true,
    configuration_sha256: configurationHash,
    resource_bindings_sha256: resourcesHash,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])),
  });
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const [name, bytes] of Object.entries(files)) {
    const fd = fs.openSync(path.join(destination, name), "wx", 0o600);
    try {
      fs.writeFileSync(fd, bytes);
    } finally {
      fs.closeSync(fd);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    demand(
      (args.length === 6 || (args.length === 8 && args[6] === "--caller")) &&
        args[0] === "--fragment" &&
        args[2] === "--policy" &&
        args[4] === "--output",
    );
    prepareSigningConfiguration(args[1], args[3], args[5], args[7] ?? null);
    process.stdout.write(
      "Prepared offline signing configuration; no deployment or activation was performed.\n",
    );
  } catch {
    process.stderr.write("Unable to prepare signing configuration.\n");
    process.exitCode = 1;
  }
}
