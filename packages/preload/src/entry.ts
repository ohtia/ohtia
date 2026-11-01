import { contextBridge, ipcRenderer } from "electron";
import {
  decodeBootstrapSnapshot,
  desktopChannels,
  isIdentifier,
  failure,
  portLimits,
  type LocaleSnapshot,
  type Outcome,
  type Subscription,
  type BootstrapAction,
  type DesktopBridge,
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
// Retain only bounded logical locale owners across private connection replacement.
const localeOwners = new Set<{
  listener: (notice: Outcome<LocaleSnapshot>) => void;
  stream: Subscription;
}>();
function subscribeLocale(listener: (notice: Outcome<LocaleSnapshot>) => void): Subscription {
  if (localeOwners.size >= portLimits.subscriptions_per_window)
    return { ready: Promise.resolve(failure("busy")), dispose() {} };
  const stream = connection.client.port.subscribeLocale(listener);
  const owner = { listener, stream };
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
const bridge: DesktopBridge = {
  foundation: {
    readLocale: () => connection.client.port.readLocale(),
    replaceLocale: (change, expectedServiceGeneration) =>
      connection.client.port.replaceLocale(change, expectedServiceGeneration),
    readLocaleReceipt: (operation) => connection.client.port.readLocaleReceipt(operation),
    subscribeLocale,
    readStatus: () => connection.client.port.readStatus(),
    readAppearance: () => connection.client.port.readAppearance(),
    readAppearanceReceipt: (operation) => connection.client.port.readAppearanceReceipt(operation),
    replaceAppearance: (change) => connection.client.port.replaceAppearance(change),
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
};
ipcRenderer.on(desktopChannels.reconnect, reconnect);
window.addEventListener(
  "unload",
  () => {
    for (const owner of localeOwners) owner.stream.dispose();
    localeOwners.clear();
    connection.client.dispose();
    ipcRenderer.removeListener(desktopChannels.preferencesReady, preferencesReady);
    ipcRenderer.removeListener(desktopChannels.ended, serviceEnded);
    ipcRenderer.removeListener(desktopChannels.reconnect, reconnect);
  },
  { once: true },
);
