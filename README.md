**Langfuse Viewer — PoC Fetcher**

- **Goal:** Fetch sessions from Langfuse’s Public API as a starting point for a custom viewer.
- **Stack:** Node.js 18+ (uses built-in `fetch`, no deps).

**Setup**

- Set env vars with your Langfuse project keys:
  - `LANGFUSE_PUBLIC_KEY`: Project public key
  - `LANGFUSE_SECRET_KEY`: Project secret key
  - `LANGFUSE_BASE_URL`: Base URL (default: `https://cloud.langfuse.com`)

Keys should belong to the project you want to read from. For self-hosted, set `LANGFUSE_BASE_URL` to your instance URL.

**Usage**

- Fetch sessions (default):
  - `LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js`

- Customize resource, limit, and page:
  - `LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js --resource sessions --limit 25 --page 1`

- Pass extra query params as JSON (merged into the querystring):
  - `LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js --resource sessions --query '{"q":"search-term"}'`

If your Langfuse deployment does not expose a `sessions` resource, try `--resource traces` to fetch traces instead:

- `LANGFUSE_PUBLIC_KEY=pk LANGFUSE_SECRET_KEY=sk node scripts/langfuse_fetch.js --resource traces --limit 50`

The script prints a short status line to stderr and the full JSON response to stdout.

**Notes**

- Auth uses HTTP Basic with `PUBLIC_KEY:SECRET_KEY` against Langfuse’s Public API.
- Endpoint format: `<BASE_URL>/api/public/<resource>?limit=<n>&page=<n>&...`.
- Common resources: `sessions` (if available), `traces`. This PoC defaults to `sessions` per our target viewer.
- If you see a 404 for `sessions`, switch to `traces` while we confirm session support/version in your deployment.

**.env Support**

- Copy `.env.example` to `.env` and fill in values:
  - `cp .env.example .env` then edit.
- The script auto-loads `.env` from the current working directory and only sets variables that are not already defined in the environment.

**Table Format & Single Fetch**

- Pretty table output:
  - `node scripts/langfuse_fetch.js --format table`
- Specify columns (comma-separated):
  - `node scripts/langfuse_fetch.js --format table --columns id,createdAt,environment`
- Fetch a single resource by id (e.g., one session):
  - `node scripts/langfuse_fetch.js --resource sessions --id 7705232444_1755775876704 --format table`

**Web UI**

- Start the local UI server (no deps):
  - `node server.js`
- Open: `http://localhost:5173`
- Features:
  - List sessions in a table with pagination controls.
  - Click a row to view full JSON details in the side panel.
- Notes:
  - The server proxies `/api/sessions` to Langfuse using your `.env` keys.
  - Keys never reach the browser; they stay on the server.

**Desktop App (Electron)**

- Prereq: Node 18+. Install dev deps:
  - `npm install`
- Run desktop in dev (wraps the same server and UI):
  - `npm run dev:desktop`
- Build installers (optional):
  - `npm run build:desktop`

Notes
- First run shows a secure key setup window. Keys are stored locally in the app data directory and never exposed to the browser/renderer.
- Desktop uses `electron/main.js` to start `server.js` in-process and opens a window at `http://localhost:PORT` (default 5173).
- Secrets stay in the main/server process; the renderer window has `nodeIntegration: false` and `contextIsolation: true`.
- The app reads `.env` from the current working directory in dev. If present, `.env` takes precedence over stored values (useful for local testing).
- You can open the key setup anytime from the main UI using the `Set Keys` button in the header (desktop only). The app restarts to apply changes.

Key storage
- Stored at `userData/credentials.json` with file mode 0600 (owner-only). On macOS/Windows/Linux this path is per-user and isolated from the app’s web content.
