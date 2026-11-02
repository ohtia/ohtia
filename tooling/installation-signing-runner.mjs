// Mutually monitored Linux guards signal only their own still-live process group.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const [role, deadlineText, program, ...args] = process.argv.slice(2);
const identity =
  process.platform === "linux"
    ? fs.readFileSync("/proc/self/stat", "utf8").split(") ").at(-1).split(" ")
    : [];
const leader = role === "supervisor" ? process.pid : Number(program);
let remaining = 0;
if (/^[1-9][0-9]{0,29}$/.test(deadlineText ?? ""))
  remaining = Number((BigInt(deadlineText) - process.hrtime.bigint() + 999999n) / 1000000n);
if (
  !["supervisor", "watchdog"].includes(role) ||
  !Number.isSafeInteger(remaining) ||
  remaining <= 0 ||
  remaining > 2147483647 ||
  !Number.isSafeInteger(leader) ||
  leader <= 1 ||
  Number(identity[2]) !== leader ||
  Number(identity[3]) !== leader ||
  (role === "supervisor" ? !path.isAbsolute(program ?? "") : process.ppid !== leader)
) {
  process.exitCode = 1;
} else {
  let finished = false;
  let timer;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (role === "supervisor")
      try {
        fs.writeSync(3, code === 0 ? "0\n" : Number.isInteger(code) ? "1\n" : "2\n");
      } catch {
        /* Parent has already gone away. */
      }
    // Current group membership pins its identity even if its original leader died.
    // Never signal a remembered positive PID/PGID after a process may have exited.
    process.kill(0, "SIGKILL");
  };
  process.on("SIGTERM", () => finish(null));
  process.on("SIGINT", () => finish(null));
  process.on("SIGHUP", () => finish(null));
  timer = setTimeout(() => finish(null), remaining);
  if (role === "watchdog") {
    // Only the supervisor owns the other end; native children never inherit it.
    const liveness = fs.createReadStream(null, { fd: 3, autoClose: false });
    liveness.on("data", () => finish(null));
    liveness.on("end", () => finish(null));
    liveness.on("error", () => finish(null));
    try {
      fs.writeSync(3, "ready\n");
    } catch {
      finish(null);
    }
  } else {
    const abort = fs.createReadStream(null, { fd: 4, autoClose: false });
    abort.on("data", () => finish(null));
    abort.on("end", () => finish(null));
    abort.on("error", () => finish(null));
    const watchdog = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "watchdog", deadlineText, String(process.pid)],
      { stdio: ["ignore", "ignore", "ignore", "pipe"], detached: false },
    );
    watchdog.once("error", () => finish(null));
    watchdog.once("exit", () => finish(null));
    watchdog.stdio[3].on("error", () => finish(null));
    watchdog.stdio[3].on("end", () => finish(null));
    let ready = "";
    let started = false;
    watchdog.stdio[3].on("data", (bytes) => {
      ready += bytes.toString();
      if (started || ready.length > 6 || !"ready\n".startsWith(ready)) finish(null);
      else if (ready === "ready\n") {
        started = true;
        // Work starts only after the watchdog has armed its liveness/deadline controls.
        if (process.hrtime.bigint() >= BigInt(deadlineText)) return finish(null);
        const child = spawn(program, args, {
          stdio: [process.stdin, process.stdout, process.stderr],
          detached: false,
        });
        child.once("error", () => finish(null));
        // A grandchild can still hold output pipes after the immediate child exits.
        child.once("exit", (code) => finish(code));
      }
    });
  }
}
