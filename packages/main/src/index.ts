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
export {
  readBoundedFile,
  admitRuntimeSwitches,
  loadRuntimeProfile,
  nativeProfileHost,
  verifyStableSentinels,
  containsPath,
} from "./profile.js";
export {
  parseLocator,
  readLocator,
  validateDataDirectory,
  LocatorPublisher,
  posixLocatorIO,
} from "./locator.js";
export type { LocatorPublicationIO, Publication, DataLocator } from "./locator.js";
export { ServiceSupervisor, recoverService } from "./service-supervisor.js";
export type { SupervisedChild } from "./service-supervisor.js";

export { RuntimeNotices } from "./error-notices.js";
export type { RuntimeError } from "./error-notices.js";
