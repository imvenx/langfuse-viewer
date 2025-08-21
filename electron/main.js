// Electron main process to wrap the existing local server + web UI
// - Starts the Node server (server.js) which serves static files and proxies API
// - Creates a BrowserWindow pointing to http://localhost:PORT
// Secrets remain in the main/server process; renderer has no Node access.

const { app, BrowserWindow, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Load env early so server.js sees them
(function loadDotEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const cleaned = line.startsWith('export ')? line.slice(7) : line;
      const eq = cleaned.indexOf('=');
      if (eq === -1) continue;
      const key = cleaned.slice(0, eq).trim();
      let val = cleaned.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
})();

const PORT = Number(process.env.PORT || 5173);

// Start the existing server in-process
function startServer() {
  try {
    // server.js invokes .listen immediately
    require(path.join(process.cwd(), 'server.js'));
  } catch (e) {
    console.error('Failed to start server.js:', e);
    dialog.showErrorBox('Server error', 'Failed to start local server. Check console for details.');
  }
}

function waitForServer(url, { timeoutMs = 10000, intervalMs = 150 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
        setTimeout(tryOnce, intervalMs);
      });
    };
    tryOnce();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  const target = `http://localhost:${PORT}`;
  waitForServer(target)
    .catch(() => {})
    .finally(() => {
      win.loadURL(target);
    });

  // Optional: remove menu in production
  if (!process.env.ELECTRON_DEVTOOLS) {
    win.setMenu(null);
  }

  // Respect OS theme for title bar / menus
  nativeTheme.themeSource = 'system';

  return win;
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

