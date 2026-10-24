import { isAbsolute } from "node:path";
import type { WebPreferences } from "electron";

/** Configure the renderer boundary; this does not create or authorize a window. */
export function rendererWebPreferences(preloadPath: string): WebPreferences {
  if (!isAbsolute(preloadPath)) throw new Error("The preload asset must have an absolute path.");
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  };
}

export { PortAdmission } from "./port-admission.js";
export type { FrameSender, WindowAuthority } from "./port-admission.js";
