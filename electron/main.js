// Electron main process to wrap the existing local server + web UI
// - Starts the Node server (server.js) which serves static files and proxies API
// - Creates a BrowserWindow pointing to http://localhost:PORT
// Secrets remain in the main/server process; renderer has no Node access.

const { app, BrowserWindow, nativeTheme, dialog, ipcMain } = require('electron');
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
const SERVICE = 'Langfuse Viewer';

function getCredsPath() {
  // Safe to call after app.whenReady()
  return path.join(app.getPath('userData'), 'credentials.json');
}

function readFallbackKeys() {
  try {
    const p = getCredsPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    if (j && j.publicKey && j.secretKey) return j;
  } catch {}
  return null;
}

function writeFallbackKeys({ publicKey, secretKey }) {
  const p = getCredsPath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ publicKey, secretKey }), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(p, 0o600); } catch {}
    return true;
  } catch (e) {
    console.error('Failed to write fallback credentials:', e);
    return false;
  }
}

async function getStoredKeys() {
  const envPub = process.env.LANGFUSE_PUBLIC_KEY;
  const envSec = process.env.LANGFUSE_SECRET_KEY;
  if (envPub && envSec) return { publicKey: envPub, secretKey: envSec };
  // Use local secure file storage in userData
  return readFallbackKeys();
}

async function saveKeys({ publicKey, secretKey }) {
  if (!publicKey || !secretKey) throw new Error('Both keys are required');
  const ok = writeFallbackKeys({ publicKey, secretKey });
  if (!ok) throw new Error('Could not persist credentials');
}

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

let setupWinRef = null;
function createSetupWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Setup Langfuse Keys',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'setup.html'));
  setupWinRef = win;
  return win;
}

ipcMain.handle('save-keys', async (_e, payload) => {
  await saveKeys(payload || {});
  if (setupWinRef && !setupWinRef.isDestroyed()) setupWinRef.close();
  // Update env for current process; server reads keys dynamically per request
  process.env.LANGFUSE_PUBLIC_KEY = payload.publicKey;
  process.env.LANGFUSE_SECRET_KEY = payload.secretKey;
  // Notify renderers so they can refresh if desired
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('keys-updated'); } catch {}
  }
  return { ok: true };
});

ipcMain.handle('open-setup', async () => {
  createSetupWindow();
  return { ok: true };
});

async function ensureKeys() {
  const existing = await getStoredKeys();
  if (existing) return existing;
  const win = createSetupWindow();
  return new Promise((resolve) => {
    win.on('closed', async () => {
      const k = await getStoredKeys();
      resolve(k);
    });
  });
}

app.whenReady().then(async () => {
  const keys = await getStoredKeys() || await ensureKeys();
  if (!keys) {
    dialog.showErrorBox('Missing keys', 'Public and secret keys are required.');
    app.quit();
    return;
  }
  process.env.LANGFUSE_PUBLIC_KEY = keys.publicKey;
  process.env.LANGFUSE_SECRET_KEY = keys.secretKey;
  startServer();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
