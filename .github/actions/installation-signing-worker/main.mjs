// The Results context remains within this fixed action; never export its token.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync(
  process.env.SIGNING_PYTHON,
  [
    "-I",
    fileURLToPath(new URL("../../../scripts/installation_signing_worker.py", import.meta.url)),
    "prepare",
  ],
  { stdio: "inherit", timeout: 240000 },
);
if (result.error || result.signal || result.status !== 0) process.exit(1);
