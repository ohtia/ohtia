import fs from "node:fs";

// Windows file handles are flushed before rename. Node cannot fsync a directory there;
// this internal journey does not claim power-loss durability on that platform.
export function synchronizeDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
