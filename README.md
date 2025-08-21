**Langfuse Session Viewer (Local + Desktop)**

Browse Langfuse sessions locally with a readable chat transcript and inline tool calls. Runs as a simple Node server in the browser or as a desktop app via Electron. Project keys never touch the browser.

![Screenshot](public/screenshot.png)

Overview
- Stack: Node.js 18+ (no deps web server), vanilla HTML/CSS/JS, optional Electron desktop wrapper.
- Secrets: kept in the server/main process; the browser only talks to a local proxy (`/api`).

Features
- Sessions list with pagination (limit/page controls).
- Chat transcript for a selected session:
  - User, assistant, and tool messages rendered as bubbles.
  - Tool calls shown inline with collapsible JSON details.
  - Toggleable raw session JSON panel.
- Desktop “Set Keys” flow to enter/update keys without touching `.env`.

Run: Web (local server)
- Start: `node server.js`
- Open: `http://localhost:5173`
- Notes:
  - The server proxies `/api/sessions` and `/api/sessions/:id` to Langfuse using `.env` or saved keys.
  - Keys never reach the browser.

Run: Desktop (Electron)
- Prereq: Node 18+
- Install dev deps: `npm install`
- Launch: `npm run dev:desktop`
- Build installers (optional): `npm run build:desktop`

Desktop Notes
- First run shows a key setup window. Keys are stored locally and never exposed to the renderer.
- The renderer is sandboxed (`nodeIntegration: false`, `contextIsolation: true`).
- You can open the key setup anytime via the “Set Keys” button (top-right).
- The app reads `.env` in dev; if present, it overrides stored values (useful for testing).

Key Storage
- Stored at `userData/credentials.json` with file mode 0600 (owner-only). This per-user path is isolated from the web content.

Configuration
- `.env` (optional):
  - `LANGFUSE_PUBLIC_KEY` — project public key
  - `LANGFUSE_SECRET_KEY` — project secret key
  - `LANGFUSE_BASE_URL` — base URL (default `https://cloud.langfuse.com`)
  - `PORT` — local server port (default `5173`)

CLI (optional)
- Fetch via the Public API from the terminal:
  - `LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js`
- Flags support table output, columns, resource selection, and single-ID fetch. See `scripts/langfuse_fetch.js`.
