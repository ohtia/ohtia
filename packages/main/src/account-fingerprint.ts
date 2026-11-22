import { createHash } from "node:crypto";

export function accountFingerprint(connection: string, input: string): string {
  return createHash("sha256")
    .update(`ohtia-account-v1\n${connection}\n${input}`, "utf8")
    .digest("hex");
}
