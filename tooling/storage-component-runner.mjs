/** This function is serialized by Playwright and runs in the native Electron main process. */
export function runStorageComponent({ utilityProcess }, input) {
  const child = utilityProcess.fork(input.helper, input.args, {
    serviceName: "Ohtia storage acceptance",
    stdio: "ignore",
    execArgv: [],
    cwd: input.scratch,
    env: input.env,
  });
  const remainingCases = new Set(input.caseIds);
  const messages = [];
  return new Promise((resolve, reject) => {
    let paused = false;
    let activeCase = input.mode;
    // Bound each declared case separately. The native suite's process supervisor still bounds the run.
    const armDeadline = () =>
      setTimeout(() => {
        reject(new Error(`Native storage case "${activeCase}" exceeded its bound.`));
        child.kill();
      }, 60_000);
    let timer = armDeadline();
    child.on("message", (message) => {
      const value = JSON.parse(message);
      if (value.kind === "case-started") {
        if (remainingCases.delete(value.id)) {
          activeCase = value.id;
          clearTimeout(timer);
          timer = armDeadline();
        }
        return;
      }
      messages.push(value);
      if (value.kind === "complete" || value.kind === "failed") {
        remainingCases.clear();
        child.postMessage("ack");
      }
      if (value.kind === "paused" && input.interrupted) {
        paused = true;
        child.kill();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, paused, messages });
    });
  });
}
