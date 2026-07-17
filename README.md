# Composer — multi-platform publishing

A small web app for composing a post once in a **Markdown editor** and publishing it to the
**channels you pick** across multiple social platforms. Ships with **Telegram**, **Discord**,
**Threads**, and **X** adapters and a **pluggable architecture** so new networks are easy to add.
Includes **user accounts**, **workspaces with invites**, and **draft saving** backed by MongoDB.

Built with [Bun](https://bun.sh), [discord.js](https://discord.js.org/),
[node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api),
[MongoDB](https://www.mongodb.com/), a [Next.js](https://nextjs.org/) frontend using
[Toast UI Editor](https://ui.toast.com/tui-editor), and an [Electron](https://www.electronjs.org/)
desktop client for local browser-based publishing.

---

## Try it — hosted instance

A live instance is already running at **[composer.bel-geek.com](https://composer.bel-geek.com)**.
Register an account there and start publishing — no setup required. Self-hosting is only needed
for a private/custom deployment.

## Quick start (self-hosted)

```bash
bun install
cp .env.example .env   # then fill in JWT_SECRET and MongoDB settings, see docs/self-hosting.md
bun run dev            # starts the Bun API server + Next.js dev server, prints the URL to open
```

Open the printed URL, register an account, write a post, pick channels, and publish.

## Documentation

- **[docs/features.md](docs/features.md)** — precise inventory of what's currently supported: the
  editor, drafts, scheduling, per-platform limits and capabilities, accounts/workspaces, and
  Composer Desktop.
- **[docs/self-hosting.md](docs/self-hosting.md)** — environment variables, `bun run dev` /
  `bun run start`, Docker, workspaces & members.
- **[docs/platforms.md](docs/platforms.md)** — how to connect Telegram, Discord, Threads, and X,
  and how to add a new platform adapter.
- **[docs/desktop.md](docs/desktop.md)** — building and running Composer Desktop, pairing it with
  a workspace, and publishing to Threads/X through it.

## How it works

```
frontend/ ── Next.js frontend (auth, drafts, channel picker, publish)
   │  built into public/, served as static files
   │  HTTP (JWT)
src/server.ts ── Bun.serve router
   ├─ auth.ts / drafts.ts ── users & drafts (MongoDB via db.ts)
   └─ platforms/registry.ts ── fans a post out to selected {platform, channel} targets
         │     (platform folders below are auto-discovered by platforms/loader.ts)
         ├─ platforms/telegram/  (Markdown → Telegram HTML)
         ├─ platforms/discord/   (Markdown → native, live channel discovery)
         ├─ platforms/bluesky/   (AT Protocol app-password publishing, 300-char threads)
         ├─ platforms/x/         (browser automation via Composer Desktop — no official API)
         └─ platforms/threads/   (browser automation via Composer Desktop — no official API)
desktop/ ── Electron app: local browser sessions for Threads/X, polls the server for publish jobs
```

Canonical content is Markdown; each platform adapter converts it to that platform's format and
chunks it to the platform's message size limit. See
[docs/platforms.md](docs/platforms.md#adding-a-new-platform) for how to add a platform.

## License

MIT
