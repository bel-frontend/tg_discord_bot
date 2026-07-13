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
- **Accounts**: register / login (passwords hashed with `Bun.password`, sessions via JWT), with
  email verification.
- **Workspaces**: an account owner can invite teammates by email, each with their own permissions
  (which channels they may publish to, and whether they may publish/delete/manage channels/manage
  other members).
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
         ├─ platforms/x.ts         (browser automation — no official API)
         └─ platforms/threads.ts   (local desktop publisher)
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
# mongodb://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DB}?authSource=${MONGODB_AUTH_SOURCE}&replicaSet=${MONGODB_REPLICA_SET}
MONGODB_PASSWORD=your-mongodb-password
MONGODB_HOST=db.example.internal
MONGODB_PORT=27017
MONGODB_USER=your-mongodb-user
MONGODB_DB=your-database-name
MONGODB_AUTH_SOURCE=admin
MONGODB_REPLICA_SET=your-replica-set
# Optional: override the generated URI completely.
# MONGODB_URI=mongodb://user:password@db.example.internal:27017/app?authSource=admin&replicaSet=rs0

# Email (Resend) — invite emails and registration email verification.
# https://resend.com/api-keys
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=Composer <onboarding@resend.dev>
# Public origin used to build invite/verification links.
PUBLIC_BASE_URL=http://localhost:3000
```

Do not commit `.env`, real tokens, passwords, or production resource IDs. Keep real values in
server-side environment variables or in the app's authenticated Settings/Resources pages.

Without `RESEND_API_KEY` set, invite and verification emails are skipped (logged to the console
instead of sent) — useful for local development.

Configure Telegram and Discord credentials in the authenticated Settings page; these settings are
stored in MongoDB per workspace, not in `.env`. Threads does not use Meta API credentials. It
publishes through a private browser session inside Composer Desktop.
X uses the same local-desktop model and does not store browser cookies on the server.

Add the channels, groups, servers, or profiles you want to publish to on the authenticated
Resources page. They are stored in MongoDB per user. Telegram bots cannot enumerate the channels
they are in, so Telegram channels must be added there manually. Discord can additionally pull a
configured server's text channels live with real `#names`; set the Discord guild id in Settings
if you want that.

### Workspaces & members

Every account is its own workspace. From the authenticated Members page, the owner (or a member
granted `canManageMembers`) can invite a teammate by email. The invite email links to a page where
the invitee sets a password (or signs in, if they already have a Composer account) and joins the
workspace with the permissions the inviter chose:

- **Channel access** — either every channel, or a specific subset of the Resources the owner has
  added.
- **canPublish** — publish/schedule posts to their allowed channels.
- **canDelete** — delete publications and cancel scheduled posts.
- **canManageChannels** — add/edit/remove channel Resources and platform (bot token) settings.
- **canManageMembers** — invite, edit, and revoke other members.

A member can never grant permissions broader than their own when inviting someone else. Inviting
requires the account owner's email to be verified first (see email verification above) so the
invite flow can't be used to spam arbitrary addresses. A person is either the owner of their own
workspace or a member of exactly one other workspace — not both.

### Connect Threads through Composer Desktop

1. Start Composer Desktop and connect it to the HTTPS address of the Composer server.
2. Sign in to Composer, then open **Settings → Threads**.
3. Click **Pair this desktop** once for the current workspace.
4. Click **Connect Threads** and sign in in the separate Composer browser window, including any
   two-factor step.

The Threads session remains in a private Electron partition on the local computer. Cookies and
passwords are never uploaded to Composer. Composer Desktop must be running and paired when a
Threads post is published. Local Threads publishing currently supports text posts up to 500
characters; media and reply chains are not implemented yet.

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

Inside Docker, the app still listens on port `3000`; compose maps it as `3007:3000` and sets the
non-secret Mongo connection parts. Put only the secret password in `.env`:

```env
MONGODB_PASSWORD=your-real-password
```

The app builds:

```text
mongodb://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DB}?authSource=${MONGODB_AUTH_SOURCE}&replicaSet=${MONGODB_REPLICA_SET}
```

Data persistence is handled by that external MongoDB deployment.

> **Note:** on Bun 1.2.8 the MongoDB driver is pinned to `mongodb@6` with a `bson@6.7.0` override
> (`package.json`) to avoid an unimplemented `node:v8` API in newer `bson`.

---

## License

MIT
