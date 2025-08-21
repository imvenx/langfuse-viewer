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
