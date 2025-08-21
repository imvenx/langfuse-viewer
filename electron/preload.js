// Preload script: expose only minimal, safe APIs to the renderer.
// Currently, the renderer fetches the app at http://localhost:PORT and calls /api/*
// via regular fetch. We do not need to expose anything.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('appBridge', {
  // reserved for future additions (e.g., openExternal, version)
});

