// preload.js - what the page may ask of the desktop app (web/app/js/apphost.js lists the commands; main.js `host` answers them).
// It runs before the page's scripts, apart from them: the page gets these two functions and nothing else of the app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopHost", {
  invoke: (name, args) => ipcRenderer.invoke("host", String(name), args),
  // events of the command under way (an update's download: how far it is)
  onEvent: (fn) => { ipcRenderer.on("host-event", (e, value) => fn(value)); },
});
