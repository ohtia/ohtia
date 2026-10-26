import electron = require("electron");

if (!process.sandboxed || !process.contextIsolated) {
  throw new Error("Probe renderer isolation failed.");
}
electron.ipcRenderer.send("probe-isolation", {
  sandboxed: process.sandboxed,
  contextIsolated: process.contextIsolated,
});

electron.contextBridge.exposeInMainWorld("ohtiaNativeProbe", {
  status: (): Promise<unknown> =>
    electron.ipcRenderer.invoke("probe-request", { operation: "status" }),
  appearance: (): Promise<unknown> =>
    electron.ipcRenderer.invoke("probe-request", { operation: "appearance-read" }),
  setAppearance: (value: unknown): Promise<unknown> => {
    if (value !== "system" && value !== "light" && value !== "dark")
      return Promise.resolve({ ok: false, code: "invalid-request" });
    return electron.ipcRenderer.invoke("probe-request", { operation: "appearance-write", value });
  },
});

electron.ipcRenderer.on("probe-invalid-requests", (_event, messageBytes: unknown) => {
  if (typeof messageBytes !== "number" || !Number.isSafeInteger(messageBytes) || messageBytes < 1)
    throw new Error("Missing canonical message bound.");
  const requests: [string, unknown][] = [
    ["null", null],
    ["unknown-operation", { operation: "delete-store" }],
    ["oversized", { operation: "x".repeat(messageBytes + 1) }],
    ["unexpected-frame-key", { operation: "status", frameUrl: location.href }],
  ];
  void Promise.all(
    requests.map(async ([caseId, request]) => ({
      caseId,
      reply: (await electron.ipcRenderer.invoke("probe-request", request)) as unknown,
    })),
  ).then((results) => {
    electron.ipcRenderer.send("probe-invalid-results", results);
  });
});

electron.ipcRenderer.on("probe-spoof-request", () => {
  void electron.ipcRenderer
    .invoke("probe-request", { operation: "status" })
    .then((reply: unknown) => {
      electron.ipcRenderer.send("probe-spoof-result", reply);
    });
});
