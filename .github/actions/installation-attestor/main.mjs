// Actions exposes the Results token only to JavaScript actions. Never export or print it.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.env.ATTESTOR_PYTHON,
  [fileURLToPath(new URL("../../../scripts/installation_attestor.py", import.meta.url))],
  { stdio: "inherit", timeout: 240_000 },
);
if (result.error || result.signal || result.status !== 0) process.exit(1);
