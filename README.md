# Composer — multi-platform publishing

A small web app for composing a post once in a **Markdown editor** and publishing it to the
**channels you pick** across multiple social platforms. Ships with **Telegram**, **Discord**, and **Threads**
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
- **Publish** to Telegram, Discord, and Threads in one click, with a per-channel success/error report.
- **Accounts**: register / login (passwords hashed with `Bun.password`, sessions via JWT).
- **Drafts**: create, autosave, reopen, and delete per-user posts (stored in MongoDB).
- **Universal adapters**: add a platform by implementing one interface and registering it.
- Canonical content is Markdown; each adapter converts it to the platform format and chunks it
  to the platform size limit.

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
         ├─ platforms/discord.ts   (Markdown → native, live channel discovery)
         └─ platforms/threads.ts   (Threads Graph API + OAuth token flow)
```

**Adding a new platform:** implement the `Platform` interface in
`src/platforms/types.ts` (`isConfigured`, `listChannels`, `publish`) and `register(...)` it in
`index.ts`. No server or frontend changes are needed — it shows up in the picker automatically.

---

## Configuration

Create a `.env` (see `.env.example`):

```env
PORT=3000
JWT_SECRET=please-change-this-to-a-long-random-string

# MongoDB. The app builds this URI:
# mongodb://admin:${MONGODB_PASSWORD}@10.8.0.34:27028/composer?authSource=admin&replicaSet=rs8
MONGODB_PASSWORD=your-mongodb-password
MONGODB_HOST=10.8.0.34
MONGODB_PORT=27028
MONGODB_USER=admin
MONGODB_DB=composer
MONGODB_AUTH_SOURCE=admin
MONGODB_REPLICA_SET=rs8
# Optional: override the generated URI completely.
# MONGODB_URI=mongodb://admin:password@10.8.0.34:27028/composer?authSource=admin&replicaSet=rs8

DISCORD_BOT_TOKEN=your-discord-bot-token
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
THREADS_APP_ID=your-threads-api-app-id
THREADS_APP_SECRET=your-threads-api-app-secret
THREADS_ACCESS_TOKEN=your-long-lived-threads-user-access-token
THREADS_USER_ID=your-threads-user-id
# Optional: force the HTTPS callback URL registered in Meta, useful behind a tunnel/proxy.
# THREADS_OAUTH_REDIRECT_URI=https://your-domain.example/api/threads/oauth/callback

# Channels shown in the picker (comma-separated; entry = "id" or "id|Friendly name")
TELEGRAM_CHANNEL_USERNAMES="@my_channel|News (TG), 553518183|Team chat"
DISCORD_CHANNEL_IDS="1374368491771002970|announcements"
DISCORD_GUILD_ID=123456789012345678        # optional: also pulls the server's channels live
THREADS_CHANNEL_IDS="12345678901234567|Threads profile"
```

The picker's channels come from these env lists. Each entry is a bare id/username or
`id|Friendly name` (the name is shown; the id is used to publish). Telegram bots cannot
enumerate their own channels, so Telegram is always listed here; Discord additionally pulls the
`DISCORD_GUILD_ID` server's text channels live (with real `#names`) and merges them in.
Threads publishes to the configured Threads profile id.

You can also add channels from an optional `channels.json` (copy `channels.example.json`); env
entries take precedence.

### Threads OAuth callbacks

For Threads, create a Meta app, add the Threads API product/use case, then register these URLs
in the Threads API settings. Replace the host with your production domain or HTTPS tunnel:

```text
OAuth redirect URL:
https://YOUR-DOMAIN/api/threads/oauth/callback

App removal callback URL:
https://YOUR-DOMAIN/api/threads/deauthorize

Data deletion callback URL:
https://YOUR-DOMAIN/api/threads/data-deletion
```

In the app Settings page, save the Threads API app id and app secret, then click
`Connect Threads`. The callback exchanges the OAuth code for a long-lived token and saves the
Threads user id automatically.

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

`docker compose up -d --build` starts the app and connects it to the configured external MongoDB.
The compose file exposes the web UI/API on host port `3007`:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3007
```

Inside Docker, the app still listens on port `3000`; compose maps it as `3007:3000` and overrides
the Mongo connection parts to use database `composer` on `10.8.0.34:27028`. Put only the secret
password in `.env`:

```env
MONGODB_PASSWORD=your-real-password
```

The app builds:

```text
mongodb://admin:${MONGODB_PASSWORD}@10.8.0.34:27028/composer?authSource=admin&replicaSet=rs8
```

Data persistence is handled by that external MongoDB deployment.

If you use `channels.json`, mount it by uncommenting the volume in `docker-compose.yml`.

> **Note:** on Bun 1.2.8 the MongoDB driver is pinned to `mongodb@6` with a `bson@6.7.0` override
> (`package.json`) to avoid an unimplemented `node:v8` API in newer `bson`.

---

## License

MIT
