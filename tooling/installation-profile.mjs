// Inspect the real native fixture and stable sentinels; this entry grants no staging or installation.
import { loadRuntimeProfile, verifyStableSentinels } from "../packages/main/dist/index.js";
if (process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(
    "Use installation-profile.mjs --inspect-profile <runtime-profile.json> to inspect the fixed native profile and stable sentinels.",
  );
  process.exit(0);
}
if (process.argv.length !== 4 || process.argv[2] !== "--inspect-profile")
  throw new Error("An explicit native profile inspection is required.");
const profile = loadRuntimeProfile(process.argv[3]);
verifyStableSentinels(profile);
process.stdout.write(JSON.stringify(profile) + "\n");
