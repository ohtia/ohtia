const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, protocol } = require("electron");

const origin = "editor-fixture://app";
protocol.registerSchemesAsPrivileged([
  { scheme: "editor-fixture", privileges: { standard: true, secure: true } },
]);
const configuration = path.join(path.dirname(app.getAppPath()), "configuration");
fs.mkdirSync(configuration, { mode: 0o700 });
app.setPath("userData", configuration);
app.whenReady().then(() => {
  const asset = new Map([
    ["/index.html", "text/html; charset=utf-8"],
    ["/editor.css", "text/css; charset=utf-8"],
    ["/renderer.js", "text/javascript; charset=utf-8"],
  ]);
  protocol.handle("editor-fixture", (request) => {
    const url = new URL(request.url);
    const type = asset.get(url.pathname);
    if (url.host !== "app" || url.search || request.method !== "GET" || !type)
      return new Response(null, { status: 403 });
    return new Response(fs.readFileSync(path.join(__dirname, url.pathname)), {
      headers: {
        "Content-Type": type,
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  const window = new BrowserWindow({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  return window.loadURL(`${origin}/index.html`);
});
app.on("window-all-closed", () => app.quit());
