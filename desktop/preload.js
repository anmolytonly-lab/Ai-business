/**
 * Preload runs with context isolation on. The UI talks to the backend over
 * HTTP exactly as it does in the browser, so nothing privileged needs to be
 * exposed — this only advertises that the app is running inside Electron.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("agentcorp", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
