// Offline administrative preview entrypoint; excluded from the deployed service bundle.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demand } from "./installation-authority.mjs";
import { prepareSigningActivation } from "./installation-signing-admission.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    demand(
      args.length === 6 &&
        args[0] === "--configuration" &&
        args[2] === "--output" &&
        args[4] === "--enabled" &&
        ["true", "false"].includes(args[5]),
    );
    prepareSigningActivation(args[1], args[3], args[5] === "true");
    process.stdout.write("Prepared offline activation metadata; no provider changes were made.\n");
  } catch {
    process.stderr.write("Unable to prepare signing activation metadata.\n");
    process.exitCode = 1;
  }
}
