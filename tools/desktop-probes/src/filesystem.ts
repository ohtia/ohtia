import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Reserve an empty fixture without opening or replacing any preexisting file. */
export function reserveProbeFile(file: string): void {
  const descriptor = openSync(file, "wx", 0o600);
  closeSync(descriptor);
}

/** Exercise only synthetic files inside a previously admitted independent root. */
export function observePublication(directory: string) {
  const destination = path.join(directory, "publication.json");
  const staging = path.join(directory, "publication.pending");
  writeFileSync(destination, '{"revision":0}\n', { flag: "wx", mode: 0o600 });
  const file = openSync(staging, "wx", 0o600);
  try {
    writeFileSync(file, '{"revision":1}\n');
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(staging, destination);
  let parentSynchronized = false;
  try {
    const parent = openSync(directory, "r");
    try {
      fsyncSync(parent);
      parentSynchronized = true;
    } finally {
      closeSync(parent);
    }
  } catch {
    // Windows needs a separately qualified native equivalent; never report durability here.
  }
  if (readFileSync(destination, "utf8") !== '{"revision":1}\n')
    throw new Error("Synthetic publication readback mismatch.");
  unlinkSync(destination);
  return { sameDirectoryReplacement: true, fileSynchronized: true, parentSynchronized };
}
