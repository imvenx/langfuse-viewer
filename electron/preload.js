// Preload script: expose only minimal, safe APIs to the renderer.
// Currently, the renderer fetches the app at http://localhost:PORT and calls /api/*
// via regular fetch. We do not need to expose anything.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appBridge', {
  // Save keys securely in OS keychain (main process)
  saveKeys: async (publicKey, secretKey) => {
    const payload = { publicKey, secretKey };
    return ipcRenderer.invoke('save-keys', payload);
  },
  // Open the secure setup window from the main UI
  openSetup: async () => ipcRenderer.invoke('open-setup'),
  onKeysUpdated: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.removeAllListeners('keys-updated');
    ipcRenderer.on('keys-updated', () => cb());
  },
});
