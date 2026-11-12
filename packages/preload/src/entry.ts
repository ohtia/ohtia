import { contextBridge, ipcRenderer } from "electron";
import {
  decodeBootstrapSnapshot,
  decodeSystemMotionNotice,
  isCommandContext,
  isCommandIntent,
  isWindowCommandRequest,
  isWindowCommandResult,
  isCommandSnapshot,
  isAboutInformation,
  isNativeCommand,
  isInterfaceLocale,
  projectLinks,
  desktopChannels,
  isIdentifier,
  failure,
  portLimits,
  type ConnectionEvent,
  type LocaleSnapshot,
  type PresentationSnapshot,
  type Outcome,
  type Subscription,
  type BootstrapAction,
  type DesktopBridge,
  type SystemMotion,
  type SystemMotionNotice,
} from "@ohtia/contracts";
import { createFoundationPort } from "./foundation-port.js";

function connect() {
  const session: unknown = ipcRenderer.sendSync(desktopChannels.session);
  if (!session || typeof session !== "object") throw new Error("Desktop session unavailable.");
  const fields = session as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !== "serviceGeneration,windowGeneration" ||
    !isIdentifier(fields.windowGeneration) ||
    !isIdentifier(fields.serviceGeneration)
  )
    throw new Error("Invalid desktop session.");
  return {
    generation: fields.serviceGeneration,
    client: createFoundationPort(
      { contextIsolated: process.contextIsolated, sandboxed: process.sandboxed },
      {
        send: (text) => {
          ipcRenderer.send(desktopChannels.port, text);
        },
        listen: (receive) => {
          const listener = (_event: unknown, text: unknown) => {
            receive(text);
          };
          ipcRenderer.on(desktopChannels.reply, listener);
          return () => {
            ipcRenderer.removeListener(desktopChannels.reply, listener);
          };
        },
      },
      {
        after: (ms, callback) => {
          const timer = setTimeout(callback, ms);
          return () => {
            clearTimeout(timer);
          };
        },
      },
      {
        windowGeneration: fields.windowGeneration,
        serviceGeneration: fields.serviceGeneration,
        nextId: () => crypto.randomUUID(),
      },
    ),
  };
}
let connection = connect();
const connectionOwners = new Set<{
  listener: (notice: Outcome<ConnectionEvent>) => void;
  dispose(): void;
}>();
function subscribeConnection(
  id: string,
  listener: (notice: Outcome<ConnectionEvent>) => void,
): Subscription {
  if (connectionOwners.size >= portLimits.subscriptions_per_window)
    return { ready: Promise.resolve(failure("busy")), dispose() {} };
  const lifetime: { active: boolean; stream?: Subscription } = { active: true };
  const owner = {
    listener,
    dispose() {
      lifetime.active = false;
      connectionOwners.delete(owner);
      lifetime.stream?.dispose();
    },
  };
  const stream = connection.client.port.subscribeConnection(id, (notice) => {
    if (!notice.ok) owner.dispose();
    try {
      listener(notice);
    } catch {
      owner.dispose();
    }
  });
  lifetime.stream = stream;
  if (lifetime.active) connectionOwners.add(owner);
  else stream.dispose();
  void stream.ready.then((outcome) => {
    if (!outcome.ok) owner.dispose();
  });
  return {
    ready: stream.ready,
    dispose: () => {
      owner.dispose();
    },
  };
}
// Retain only bounded logical locale owners across private connection replacement.
const localeOwners = new Set<{
  listener: (notice: Outcome<LocaleSnapshot> | Outcome<PresentationSnapshot>) => void;
  stream: Subscription;
}>();
function subscribeLocale(listener: (notice: Outcome<LocaleSnapshot>) => void): Subscription {
  if (localeOwners.size >= portLimits.subscriptions_per_window)
    return { ready: Promise.resolve(failure("busy")), dispose() {} };
  const stream = connection.client.port.subscribeLocale(listener);
  const owner = {
    listener: listener as (notice: Outcome<LocaleSnapshot> | Outcome<PresentationSnapshot>) => void,
    stream,
  };
  localeOwners.add(owner);
  return {
    ready: stream.ready,
    dispose() {
      localeOwners.delete(owner);
      stream.dispose();
    },
  };
}
function subscribePresentation(
  listener: (notice: Outcome<PresentationSnapshot>) => void,
): Subscription {
  if (localeOwners.size >= portLimits.subscriptions_per_window)
    return { ready: Promise.resolve(failure("busy")), dispose() {} };
  const stream = connection.client.port.subscribePresentation(listener);
  const owner = {
    listener: listener as (notice: Outcome<LocaleSnapshot> | Outcome<PresentationSnapshot>) => void,
    stream,
  };
  localeOwners.add(owner);
  return {
    ready: stream.ready,
    dispose() {
      localeOwners.delete(owner);
      stream.dispose();
    },
  };
}
const preferencesReady = (_event: unknown, generation: unknown) => {
  if (generation !== connection.generation) return;
  for (const owner of [...localeOwners]) {
    try {
      owner.listener(failure("sequence_gap"));
    } catch {
      localeOwners.delete(owner);
      owner.stream.dispose();
    }
  }
};
ipcRenderer.on(desktopChannels.preferencesReady, preferencesReady);
async function bootstrap(action: BootstrapAction) {
  const result: unknown = await ipcRenderer.invoke(desktopChannels.bootstrap, action);
  const snapshot = decodeBootstrapSnapshot(result);
  if (!snapshot) throw new Error("Invalid bootstrap response.");
  return snapshot;
}
const commandListeners = new Set<Parameters<DesktopBridge["commands"]["onIntent"]>[0]>();
let commandContext: Awaited<ReturnType<DesktopBridge["commands"]["context"]>> | undefined;
const commandIntent = (_event: unknown, input: unknown) => {
  if (
    !isCommandIntent(input) ||
    input.source !== "native" ||
    input.windowGeneration !== commandContext?.windowGeneration
  )
    return;
  for (const listener of commandListeners) {
    try {
      listener(input);
    } catch {
      commandListeners.delete(listener);
    }
  }
};
ipcRenderer.on(desktopChannels.commandIntent, commandIntent);
// Sequenced notices let the synchronous initial read and earlier queued pushes arrive in any order.
const motionListeners = new Set<(value: SystemMotion) => void>();
let motion: SystemMotionNotice = { sequence: -1, value: "unknown" };
function acceptMotion(input: unknown): void {
  const notice = decodeSystemMotionNotice(input);
  if (!notice || notice.sequence <= motion.sequence) return;
  const changed = notice.value !== motion.value;
  motion = notice;
  if (!changed) return;
  for (const listener of [...motionListeners]) {
    try {
      listener(notice.value);
    } catch {
      motionListeners.delete(listener);
    }
  }
}
const systemMotion = (_event: unknown, input: unknown) => {
  acceptMotion(input);
};
ipcRenderer.on(desktopChannels.systemMotion, systemMotion);
acceptMotion(ipcRenderer.sendSync(desktopChannels.systemMotion));
async function commandBoolean(action: string, payload: unknown): Promise<boolean> {
  const value: unknown = await ipcRenderer.invoke(desktopChannels.commands, action, payload);
  return value === true;
}
const bridge: DesktopBridge = {
  commands: {
    async windowAction(request) {
      if (
        !isWindowCommandRequest(request) ||
        request.intent.windowGeneration !== commandContext?.windowGeneration
      )
        return { status: "stale_context" };
      const result: unknown = await ipcRenderer.invoke(
        desktopChannels.commands,
        "window_action",
        request,
      );
      return isWindowCommandResult(result) ? result : { status: "failed" };
    },
    async context() {
      const value: unknown = await ipcRenderer.invoke(
        desktopChannels.commands,
        "context",
        undefined,
      );
      if (!isCommandContext(value)) throw new Error("Invalid command context.");
      commandContext = value;
      return value;
    },
    publish: (snapshot) =>
      isCommandSnapshot(snapshot) && snapshot.windowGeneration === commandContext?.windowGeneration
        ? commandBoolean("publish", snapshot)
        : Promise.resolve(false),
    onIntent(listener) {
      if (commandListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("Command listener limit reached.");
      commandListeners.add(listener);
      return () => {
        commandListeners.delete(listener);
      };
    },
    async about() {
      const value: unknown = await ipcRenderer.invoke(desktopChannels.commands, "about", undefined);
      if (!isAboutInformation(value)) throw new Error("Invalid About information.");
      return value;
    },
    copyVersionInformation: (locale) =>
      isInterfaceLocale(locale) ? commandBoolean("copy_version", locale) : Promise.resolve(false),
    perform: (command) =>
      isNativeCommand(command) ? commandBoolean("perform", command) : Promise.resolve(false),
    openLink: (link) =>
      typeof link === "string" && Object.hasOwn(projectLinks, link)
        ? commandBoolean("open_link", link)
        : Promise.resolve(false),
  },
  system: {
    readMotion: () => motion.value,
    subscribeMotion(listener) {
      if (typeof listener !== "function") throw new TypeError("Invalid system motion listener.");
      if (motionListeners.size >= portLimits.subscriptions_per_window)
        throw new Error("System motion listener limit reached.");
      motionListeners.add(listener);
      return () => {
        motionListeners.delete(listener);
      };
    },
  },
  foundation: {
    readConnection: (id) => connection.client.port.readConnection(id),
    connectConnection: (id, options) => connection.client.port.connectConnection(id, options),
    disconnectConnection: (id) => connection.client.port.disconnectConnection(id),
    probeConnection: (id) => connection.client.port.probeConnection(id),
    listConnectionModels: (input) => connection.client.port.listConnectionModels(input),
    subscribeConnection,
    readPresentation: () => connection.client.port.readPresentation(),
    subscribePresentation,
    replaceCharacter: (change, generation) =>
      connection.client.port.replaceCharacter(change, generation),
    readCharacterReceipt: (id) => connection.client.port.readCharacterReceipt(id),
    replaceZoom: (change, generation) => connection.client.port.replaceZoom(change, generation),
    adjustZoom: (id, intent, generation) =>
      connection.client.port.adjustZoom(id, intent, generation),
    readZoomReceipt: (id) => connection.client.port.readZoomReceipt(id),
    applyZoom: () => connection.client.port.applyZoom(),
    readLocale: () => connection.client.port.readLocale(),
    replaceLocale: (change, expectedServiceGeneration) =>
      connection.client.port.replaceLocale(change, expectedServiceGeneration),
    readLocaleReceipt: (operation) => connection.client.port.readLocaleReceipt(operation),
    subscribeLocale,
    claimLayoutFailureNotice: () => connection.client.port.claimLayoutFailureNotice(),
    readLayout: () => connection.client.port.readLayout(),
    replaceLayout: (change) => connection.client.port.replaceLayout(change),
    readLayoutReceipt: (operation) => connection.client.port.readLayoutReceipt(operation),
    readStatus: () => connection.client.port.readStatus(),
    readAppearance: () => connection.client.port.readAppearance(),
    readAppearanceReceipt: (operation) => connection.client.port.readAppearanceReceipt(operation),
    replaceAppearance: (change, generation) =>
      connection.client.port.replaceAppearance(change, generation),
    subscribeStatus: (listener) => connection.client.port.subscribeStatus(listener),
    subscribeAppearance: (listener) => connection.client.port.subscribeAppearance(listener),
  },
  bootstrap: {
    read: () => bootstrap("read"),
    retryService: () => bootstrap("retry_service"),
    newWindow: () => bootstrap("new_window"),
    exit: () => bootstrap("exit"),
    restoreCheckpoint: () => bootstrap("restore_checkpoint"),
    openStorage: () => bootstrap("open_storage"),
  },
};
contextBridge.exposeInMainWorld("ohtia", bridge);
const serviceEnded = (_event: unknown, ended: unknown) => {
  if (ended === connection.generation) connection.client.dispose();
};
ipcRenderer.on(desktopChannels.ended, serviceEnded);
const reconnect = () => {
  connection.client.dispose();
  connection = connect();
  for (const owner of [...connectionOwners]) {
    owner.dispose();
    try {
      owner.listener(failure("sequence_gap"));
    } catch {
      /* Consumer cannot interrupt reconnect. */
    }
  }
};
ipcRenderer.on(desktopChannels.reconnect, reconnect);
window.addEventListener(
  "unload",
  () => {
    commandListeners.clear();
    motionListeners.clear();
    ipcRenderer.removeListener(desktopChannels.systemMotion, systemMotion);
    ipcRenderer.removeListener(desktopChannels.commandIntent, commandIntent);
    for (const owner of localeOwners) owner.stream.dispose();
    localeOwners.clear();
    for (const owner of connectionOwners) owner.dispose();
    connectionOwners.clear();
    connection.client.dispose();
    ipcRenderer.removeListener(desktopChannels.preferencesReady, preferencesReady);
    ipcRenderer.removeListener(desktopChannels.ended, serviceEnded);
    ipcRenderer.removeListener(desktopChannels.reconnect, reconnect);
  },
  { once: true },
);
