/**
 * Electron wrapper. Boots the same Express server in-process and loads the
 * same built frontend the web app serves — there is no desktop-only UI, and
 * the web app runs perfectly well without Electron.
 *
 * The renderer is locked down: no Node integration, context isolation on,
 * sandboxed, and navigation is confined to the local server. Anything else
 * opens in the user's real browser.
 */
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");

// The app's working directory decides where .env, data/ and agents/ live.
// In a packaged build those sit next to the executable rather than inside asar.
const APP_ROOT = app.isPackaged
  ? path.dirname(app.getPath("exe"))
  : path.resolve(__dirname, "..");
process.chdir(APP_ROOT);

let serverPort = null;
let closeServer = null;
let mainWindow = null;

function backendEntry() {
  const compiled = path.join(__dirname, "..", "dist", "index.js");
  if (!fs.existsSync(compiled)) {
    throw new Error(
      `Backend not built. Run "npm run build" first (looked for ${compiled}).`
    );
  }
  return compiled;
}

/** Is an AgentCorp server already listening on this port? */
async function probeExisting(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://localhost:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Prefer an already-running server (started with `npm start`) and attach to
 * it; otherwise boot one in-process.
 *
 * Attaching matters for more than convenience: the in-process path loads
 * better-sqlite3 inside Electron, whose native ABI differs from Node's, so it
 * needs `npm run rebuild:electron` first. Attaching to a server running under
 * plain Node needs no rebuild at all.
 */
async function startBackend() {
  const preferredPort = Number(process.env.PORT || 3000);
  if (await probeExisting(preferredPort)) {
    console.log(`attaching to the AgentCorp server already running on ${preferredPort}`);
    serverPort = preferredPort;
    closeServer = null; // we didn't start it, so we don't stop it
    return preferredPort;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startServer } = require(backendEntry());
  // Port 0 = let the OS pick a free one, so the desktop app never fights a
  // web instance already listening on 3000.
  const started = await startServer(0);
  serverPort = started.port;
  closeServer = started.close;
  return started.port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0d13",
    title: "AgentCorp",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const origin = `http://localhost:${port}`;

  // Keep the renderer on the local app; send anything else to the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(origin);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Data Folder",
          click: () => void shell.openPath(path.join(APP_ROOT, "data")),
        },
        {
          label: "Open Agents Folder",
          click: () => void shell.openPath(path.join(APP_ROOT, "agents")),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open in Browser",
          click: () => {
            if (serverPort !== null) void shell.openExternal(`http://localhost:${serverPort}`);
          },
        },
        {
          label: "About AgentCorp",
          click: () => {
            void dialog.showMessageBox({
              type: "info",
              title: "AgentCorp",
              message: "AgentCorp",
              detail:
                `An autonomous AI-run business.\n\n` +
                `The desktop app runs the same server and the same UI as the web ` +
                `version — it is a wrapper, not a fork.\n\n` +
                `API: http://localhost:${serverPort ?? "?"}\nData: ${APP_ROOT}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One instance only — two would race on the same SQLite file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("ready", () => {
    startBackend()
      .then((port) => {
        buildMenu();
        createWindow(port);
      })
      .catch((err) => {
        const message = err && err.message ? err.message : String(err);
        // Print before the dialog: a modal blocks forever on a headless box.
        console.error("AgentCorp could not start:", message);
        const abiHint = message.includes("NODE_MODULE_VERSION")
          ? `\n\nThis is the native-module ABI mismatch: better-sqlite3 is built for ` +
            `Node, but Electron needs its own build. Either run "npm run rebuild:electron" ` +
            `once, or start the server separately with "npm start" and relaunch — the ` +
            `desktop app will attach to it.`
          : "";
        dialog.showErrorBox(
          "AgentCorp could not start",
          `${message}\n\nCheck that you have run "npm run build:all" and that .env ` +
            `contains a GEMINI_API_KEY.${abiHint}`
        );
        app.exit(1);
      });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort !== null) {
      createWindow(serverPort);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    if (typeof closeServer === "function") closeServer();
  });
}
