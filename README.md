# Composer — multi-platform publishing

A small web app for composing a post once in a **Markdown editor** and publishing it to the
**channels you pick** across multiple social platforms. Ships with **Telegram** and **Discord**
adapters and a **pluggable architecture** so new networks are easy to add. Includes **user
accounts** and **draft saving** backed by MongoDB.

Built with [Bun](https://bun.sh), [discord.js](https://discord.js.org/),
[node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api),
[MongoDB](https://www.mongodb.com/), and a [Next.js](https://nextjs.org/) frontend
using [Toast UI Editor](https://ui.toast.com/tui-editor).

---

## Features

- **Markdown composer** (Toast UI Editor: WYSIWYG + Markdown, live preview, light/dark theme).
- **Pick channels by name** (mapped internally to real channel IDs), grouped by platform.
- **Publish** to Telegram + Discord in one click, with a per-channel success/error report.
- **Accounts**: register / login (passwords hashed with `Bun.password`, sessions via JWT).
- **Drafts**: create, autosave, reopen, and delete per-user posts (stored in MongoDB).
- **Universal adapters**: add a platform by implementing one interface and registering it.
- Canonical content is Markdown; each adapter converts it (Telegram → HTML, Discord → native MD)
  and chunks it to the platform size limit (4096 / 2000).

---

## How it works

```
frontend/ ── Next.js frontend (auth, drafts, channel picker, publish)
   │  built into public/, served as static files
   │  HTTP (JWT)
src/server.ts ── Bun.serve router
   ├─ auth.ts / drafts.ts ── users & drafts (MongoDB via db.ts)
   └─ platforms/registry.ts ── fans a post out to selected {platform, channel} targets
         ├─ platforms/telegram.ts  (Markdown → Telegram HTML)
         └─ platforms/discord.ts   (Markdown → native, live channel discovery)
```

**Adding a new platform:** implement the `Platform` interface in
`src/platforms/types.ts` (`isConfigured`, `listChannels`, `publish`) and `register(...)` it in
`index.ts`. No server or frontend changes are needed — it shows up in the picker automatically.

---

## Configuration

Create a `.env` (see `.env.example`):

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017      # or mongodb://mongo:27017 with docker-compose
MONGODB_DB=tg_discord_bot
JWT_SECRET=please-change-this-to-a-long-random-string

DISCORD_BOT_TOKEN=your-discord-bot-token
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# Channels shown in the picker (comma-separated; entry = "id" or "id|Friendly name")
TELEGRAM_CHANNEL_USERNAMES="@my_channel|News (TG), 553518183|Team chat"
DISCORD_CHANNEL_IDS="1374368491771002970|announcements"
DISCORD_GUILD_ID=123456789012345678        # optional: also pulls the server's channels live
```

The picker's channels come from these env lists. Each entry is a bare id/username or
`id|Friendly name` (the name is shown; the id is used to publish). Telegram bots cannot
enumerate their own channels, so Telegram is always listed here; Discord additionally pulls the
`DISCORD_GUILD_ID` server's text channels live (with real `#names`) and merges them in.

You can also add channels from an optional `channels.json` (copy `channels.example.json`); env
entries take precedence.

---

## Running

**Production / single process** — build the Next.js frontend, then run the Bun server (which
serves the built UI + API on one port):

```bash
bun install
bun run start        # builds frontend into public/, then starts the server
```

Open `http://localhost:3000`, register an account, write a post, pick channels, and Publish.

**Development** — run the API server and the Next.js dev server together:

```bash
bun run dev          # starts the Bun API server and Next.js dev server
```

Then open the frontend URL printed by Next.js. The frontend lives in `frontend/` (its own package);
`bun run build` compiles it into `public/`.

### Docker

`docker compose up -d --build` starts the app **and** a MongoDB service. Set
`MONGODB_URI=mongodb://mongo:27017` in `.env` so the app reaches the bundled database, and mount
your `channels.json` (see the commented volume in `docker-compose.yml`). The web UI is exposed on
`PORT` (default 3000).

> **Note:** on Bun 1.2.8 the MongoDB driver is pinned to `mongodb@6` with a `bson@6.7.0` override
> (`package.json`) to avoid an unimplemented `node:v8` API in newer `bson`.

---

## License

MIT
