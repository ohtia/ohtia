/** Install the non-shipping hold before requesting a new data-service generation. */
export function installStorageNoticeHold({ utilityProcess }) {
  let resolveHeld;
  globalThis.__storageNoticeHeld = new Promise((resolve) => {
    resolveHeld = resolve;
  });
  const fork = utilityProcess.fork;
  utilityProcess.fork = (...args) => {
    utilityProcess.fork = fork;
    const child = fork.apply(utilityProcess, args);
    const emit = child.emit;
    child.emit = function (event, ...values) {
      if (
        event === "message" &&
        typeof values[0] === "string" &&
        JSON.parse(values[0]).kind === "storage"
      ) {
        globalThis.__heldStoragePid = child.pid;
        globalThis.__releaseStorageNotice = () => {
          child.emit = emit;
          emit.call(child, event, ...values);
        };
        resolveHeld();
        return true;
      }
      return emit.call(child, event, ...values);
    };
    return child;
  };
}

/** Serialized into Electron main; resolving this signal never releases the held message. */
export function readHeldStorageNotice() {
  const held = globalThis.__storageNoticeHeld;
  if (!(held instanceof Promise)) throw new Error("Storage notice hold is not installed.");
  return held;
}

/** Bound the whole native round trip by the original five seconds, including a stalled main. */
export async function waitForHeldStorageNotice(application) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), 5000);
  });
  try {
    return await Promise.race([
      application.evaluate(readHeldStorageNotice).then(() => true),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
