# Self-hosting

## Requirements

- [Bun](https://bun.sh) (used as the runtime and package manager for every workspace: root,
  `frontend/`, and `desktop/`).
- A MongoDB instance (self-managed or hosted). Composer does not bundle one.

## Configuration

Copy `.env.example` to `.env` and fill it in — `.env.example` is the source of truth for every
variable the app reads:

```bash
cp .env.example .env
```

```env
# --- Web / editor ---
PORT=3000                 # API server port for `bun run start`
JWT_SECRET=please-change-this-to-a-long-random-string

# --- MongoDB ---
# The app builds this URI from the parts below:
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

# --- Email (Resend), for invites and registration verification ---
# https://resend.com/api-keys
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=Composer <onboarding@resend.dev>
PUBLIC_BASE_URL=http://localhost:3000   # used to build invite/verification links

# --- Scheduler ---
SCHEDULER_INTERVAL_MS=30000   # how often the background worker checks for due scheduled posts
```

Optional overrides (dev/Docker port handling only — see `.env.example` for the full list):
`DOCKER_HOST_PORT`, `PORT_MAX`, `FRONTEND_PORT`, `API_PROXY_TARGET`.

Never commit `.env`, real tokens, passwords, or production channel/resource ids.

Without `RESEND_API_KEY` set, invite and verification emails are skipped (logged to the console
instead of sent) — this is fine for local development.

**Telegram and Discord bot tokens are not set through `.env`.** They are entered per workspace in
the authenticated Settings page and stored in MongoDB. See
[docs/platforms.md](platforms.md) for how to obtain and enter them, and how to add the channels
you want to publish to on the Resources page.

## Running

**Production / single process** — build the Next.js frontend, then run the Bun server (serves the
built UI + API on one port):

```bash
bun install
bun run start        # runs `bun run build` (frontend → public/), then starts the server
```

Open `http://localhost:3000`, register an account, write a post, pick channels, and publish.

**Development** — run the API server and the Next.js dev server together:

```bash
bun run dev
```

`bun run dev` (`scripts/dev.ts`) scans for a free backend port starting at `PORT` (default
`3001`), points the Next.js dev server's API proxy at whichever port it actually binds, and prints
both URLs. Open the frontend URL it prints.

Other commands (see `package.json` / `AGENTS.md`):

```bash
bun run build                          # cd frontend && bun install && bun run build → public/
bun test src/*.test.ts                 # backend tests only
cd frontend && bun run test            # frontend tests only (Vitest)
bun run test                           # both, sequentially
cd frontend && bun run dev             # frontend dev server on its own, without the API proxy
```

> If `bun run dev` or `bun run start` won't bind, something else may already be holding the port —
> often a leftover `bun --watch index.ts` from a previous session. Check with
> `lsof -nP -iTCP:3000 -sTCP:LISTEN` (swap in the port in question) and kill the PID it reports.

## Docker

`docker compose up -d --build` starts the app and connects it to the configured external MongoDB.
The compose file maps the container's port `3000` to host port `3007` (override with
`DOCKER_HOST_PORT`):

```bash
docker compose up -d --build
```

Open `http://localhost:3007`.

Put only the secret password in `.env`; the compose file sets the non-secret Mongo connection
parts (host/port/user/db/etc.) itself:

```env
MONGODB_PASSWORD=your-real-password
```

Data persistence is handled by that external MongoDB deployment, not by the container.

> **Note:** on Bun 1.2.8 the MongoDB driver is pinned to `mongodb@6` with a `bson@6.7.0` override
> (`package.json`) to avoid an unimplemented `node:v8` API in newer `bson`.

## Workspaces & members

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
requires the account owner's email to be verified first (see email verification above), so the
invite flow can't be used to spam arbitrary addresses. A person is either the owner of their own
workspace or a member of exactly one other workspace — not both.
