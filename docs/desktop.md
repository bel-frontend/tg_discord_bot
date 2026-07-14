# Composer Desktop

Composer Desktop is an [Electron](https://www.electronjs.org/) app (`desktop/`) that runs the same
Composer web UI in a window, plus a local publisher agent that handles Threads and X: it keeps a
private browser session with your logged-in Threads/X account on your own computer and posts on
the server's behalf. Threads/X credentials and cookies never leave your machine (see
[docs/platforms.md](platforms.md#threads-and-x)).

## Requirements

- Bun (used to build the Electron main/preload bundle).
- `desktop/` has its own `package.json` (`electron`, `electron-builder` as dev dependencies) — run
  `bun install` inside it once, or let the scripts below do it via `bun run`.

## Development

From the repo root, run both the Composer server and Composer Desktop together, wired to each
other automatically:

```bash
bun run desktop:dev
```

This runs `scripts/desktop-dev.ts`, which starts `bun run dev` (the API + Next.js dev server),
waits for it to answer on `http://localhost:3000` (or `$COMPOSER_DESKTOP_DEV_URL` if set), then
launches Electron in `desktop/` pointed at that URL. Stopping it (Ctrl-C) kills both processes.

To run Composer Desktop on its own against an already-running server:

```bash
cd desktop
bun install
COMPOSER_DESKTOP_DEV_URL=http://localhost:3000 bun run dev
```

`bun run dev` in `desktop/` runs `bun run build` (bundles `src/main.ts` and `src/preload.ts` into
`dist/` as CommonJS, with `electron` external) and then launches `electron .`. In an unpackaged dev
build, `COMPOSER_DESKTOP_DEV_URL` auto-registers/selects a matching environment so it behaves like
any other saved environment (same pairing/token flow) instead of a separate code path. Packaged
apps require an `https://` server URL; the dev override is the only way to point Composer Desktop
at plain `http://localhost`.

## Building installers

```bash
bun run desktop:dist        # from the repo root
# or
cd desktop && bun run dist
```

This builds the bundle and runs `electron-builder`, producing installers under `desktop/release/`:

- macOS: `.dmg` and `.zip`
- Windows: an NSIS installer (`.exe`)

There is no Linux target configured in `desktop/package.json` (`build.mac`/`build.win`) at the
moment.

## First run: choosing a server

On first launch (or whenever no environment is configured), Composer Desktop shows an
"environments" page (`desktop/src/setup.html`) instead of the Composer UI. Add a name and the
`https://` address of your Composer server (e.g. `https://composer.example.com`) and it switches
to that server immediately. Use the tray menu ("Switch Environment…") or the **Composer** menu to
add, switch between, or remove saved servers later — each is stored locally in
`app.getPath('userData')/config.json` together with its pairing token.

## Pairing a workspace

1. Sign in to Composer inside the desktop window (or the regular browser — either works, since
   they hit the same server) and open **Settings → Threads** or **Settings → X**.
2. Click **Pair this desktop**. This mints a one-time pairing code from the server
   (`POST /api/local-publishers/pairing`) and immediately exchanges it for a long-lived agent
   token through the Electron bridge — there's no code to copy/paste by hand. The token is saved
   in the desktop app's local config and used for every subsequent request
   (`x-local-publisher-token` header).
3. Once paired, **Connect Threads** / **Connect X** opens a separate private browser window inside
   Composer Desktop for you to log in (including any 2FA step). The session stays in that private
   Electron session/partition; it is never uploaded to the server.

While paired, Composer Desktop sends a heartbeat every 15 seconds
(`POST /api/local-publishers/heartbeat`) reporting which platforms are connected, and polls for
publish jobs every 2 seconds (`POST /api/local-publishers/jobs/claim`) so it can execute Threads/X
publishes queued by the server. It must be running for those publishes to go through.

## Clearing a session

- In Composer's Settings page, use **Disconnect** / **Clear session data** for Threads or X.
- Or from the desktop app's tray icon: **Clear Threads session** / **Clear X session**.

Either wipes cookies, cache, and the stored login for that platform from the local computer;
reconnecting starts from a clean login.
