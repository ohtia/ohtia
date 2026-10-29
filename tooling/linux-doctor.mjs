// Read-only admission: return only the admitted snapshot; never start Electron.
import { loadRuntimeProfile, verifyStableSentinels } from "../packages/main/dist/index.js";
import { admittedLaunch } from "./desktop-launch.mjs";
try {
  const context = process.argv[2] === "--context";
  const [profileFile, runtime] = process.argv.slice(context ? 3 : 2);
  const launch = runtime ? admittedLaunch(profileFile, runtime) : undefined;
  const profile = launch?.profile ?? loadRuntimeProfile(profileFile);
  if (!launch) verifyStableSentinels(profile);
  if (context)
    console.log(
      JSON.stringify({
        configuration_root: profile.configuration_root,
        research_root: profile.research_root,
        scratch_root: profile.scratch_root,
        stable_roots: Object.values(profile.stable_roots).map((root) => root.root),
        ...(launch ? { executable: launch.executable } : {}),
      }),
    );
} catch {
  console.error(
    "Inspect the independent native profile, sentinels and prepared runtime before retrying.",
  );
  process.exitCode = 1;
}
