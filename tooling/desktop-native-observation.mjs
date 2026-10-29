// Record ready packaged-process identities for unprivileged native observation.
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function recordReadyNativeProcesses(application, output) {
  const nativeProcesses = await application.evaluate(({ app }) => {
    const fs = process.getBuiltinModule("fs");
    return app.getAppMetrics().flatMap(({ pid, type, creationTime }) => {
      let start_time = null;
      if (process.platform === "linux") {
        try {
          const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
          start_time = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
        } catch {
          return [];
        } // A process may exit between metrics and the identity read.
      }
      if (process.platform === "win32" && (!Number.isFinite(creationTime) || creationTime <= 0))
        throw new Error("Missing native process creation identity.");
      return [
        {
          pid,
          renderer: type === "Tab",
          start_time,
          ...(process.platform === "win32" ? { creation_time_ms: creationTime } : {}),
        },
      ];
    });
  });
  const processFile = path.join(output, "native-processes.json");
  fs.writeFileSync(`${processFile}.tmp`, JSON.stringify({ processes: nativeProcesses }));
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(`${processFile}.tmp`, processFile);
      break;
    } catch (error) {
      // A Windows reader may briefly hold the old file without FILE_SHARE_DELETE.
      if (attempt === 4 || !["EPERM", "EBUSY"].includes(error.code)) throw error;
      await delay(20);
    }
  }
}
