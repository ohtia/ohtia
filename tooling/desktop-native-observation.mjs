// Record ready packaged-process identities for unprivileged native observation.
import fs from "node:fs";
import path from "node:path";

export async function recordReadyNativeProcesses(application, output) {
  const nativeProcesses = await application.evaluate(({ app }) => {
    const fs = process.getBuiltinModule("fs");
    return app.getAppMetrics().flatMap(({ pid, type }) => {
      let start_time = null;
      if (process.platform === "linux") {
        try {
          const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
          start_time = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
        } catch {
          return [];
        } // A process may exit between metrics and the identity read.
      }
      return [{ pid, renderer: type === "Tab", start_time }];
    });
  });
  const processFile = path.join(output, "native-processes.json");
  fs.writeFileSync(`${processFile}.tmp`, JSON.stringify(nativeProcesses));
  fs.renameSync(`${processFile}.tmp`, processFile);
}
