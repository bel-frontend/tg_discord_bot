# Current features

This is a precise inventory of what Composer supports today, verified against the current code
(not aspirations or old README claims). File references point at the implementation for anything
specific (limits, intervals, permission names).

## Editor (composer)

- Toast UI Markdown/WYSIWYG editor with Edit / Preview / Sent tabs
  (`frontend/src/components/ComposerEditorPane.tsx`).
- **Find & replace** on the raw markdown text — plain substring match, case-insensitive, no regex
  for the user (`frontend/src/hooks/useFindReplace.ts`).
- **Live per-platform preview**: debounced 250ms call to `/api/preview`, one tab per target
  platform (`frontend/src/components/PreviewPanel.tsx`).
- **Title**: typed manually, or auto-derived from the first non-empty markdown line, truncated to
  80 characters with an ellipsis (`frontend/src/lib/title.ts`).
- **Image attachments**: drag/drop, paste, or file picker. `image/*` only, 10 MB max per image,
  enforced both when uploading and again on publish (`src/uploads.ts`, `src/publishRequest.ts`).
  No limit on the *number* of images attached.
- **External image URLs**: comma-separated URLs can be used instead of/alongside uploads
  (`frontend/src/components/ComposerSidebar.tsx`).
- **Silent mode**: publish without triggering a notification. Wired through to Telegram
  (`disable_notification`) and Discord (`MessageFlags.SuppressNotifications`); Threads and X
  ignore it — see [Platforms](#platforms) below.
- Focus mode and fullscreen editing, both remembered per-browser in `localStorage`.
- Character count with a per-platform limit warning once you're over the strictest target's limit.
- Validation errors (see [Validation](#publishing--validation)) jump the cursor to the likely
  source line in the markdown.
- Publishing again after a post already went out always creates a **new** post; there is no
  "resend as edit" from the composer — editing sent messages happens from the **Sent** tab
  (see [Published history](#published-history)).

## Drafts

- **Autosave** with a 1000ms debounce after you stop typing (`frontend/src/hooks/useAutosave.ts`).
- **Draft folders** are stored on the server and shared across devices for the same account
  (`src/draftFolders.ts`): create, rename, reorder, delete. Deleting a folder cascades — it also
  deletes the drafts inside it, and any scheduled/publication records tied to those drafts.
  (Folder *collapse* state in the sidebar is local-only, `localStorage`.)
- Drag-and-drop to pin a draft, rename it inline, or move it into/out of a folder (dropping at the
  root un-files it) — `frontend/src/components/DraftsRail/`.
- Deleting a single draft asks for confirmation and removes its scheduled/publication records too.

## Channel picker & resources

- Channels/servers/profiles you publish to ("Resources") are stored **per workspace account**, not
  per individual member (`src/channelResources.ts`).
- **Live channel discovery** only exists for:
  - Discord — needs a bot token *and* a configured server (guild) id (`src/platforms/discord.ts`).
  - Threads/X — lists a single "Local … profile" pseudo-channel when a paired Composer Desktop is
    online (`src/platforms/threads.ts`, `src/platforms/x.ts`).
  - Telegram has **no discovery at all**: bots can't enumerate the channels they're in, so every
    Telegram target must be added manually as a Resource.
- **Pinning** and **folder grouping** in the channel picker itself are client-side conveniences
  only (`localStorage`) — unlike draft folders, they are not synced across devices or shared with
  other workspace members.

## Publishing & validation

- One post fans out to every selected `{platform, channel}` target in a single publish call,
  grouped so each platform adapter is invoked once (`src/platforms/registry.ts`).
- **Content validation** before publish currently exists only for Telegram: it checks the
  converted HTML for tag balance against Telegram's supported tag whitelist
  (`src/telegramValidation.ts`). Discord, Threads, and X have no pre-publish content validation.
- **Per-platform message limits**, each with automatic chunking into multiple messages when
  exceeded:

  | Platform | Limit        | Long-post behavior |
  |----------|--------------|---------------------|
  | Telegram | 4096 chars   | Split into multiple messages |
  | Discord  | 2000 chars   | Split into multiple messages |
  | Threads  | 500 chars    | **Rejected** — "reply chains are not implemented yet" |
  | X        | 280 chars    | Auto-split into a reply thread |

  (`src/chunk.ts`, `src/platforms/threads.ts`, `src/platforms/x.ts`)

- **Editing/deleting an already-published post**: Telegram and Discord support both `update()` and
  `delete()` (edit messages in place, add/remove trailing chunks as needed). **Threads and X
  support neither** — attempting either returns "\<platform\> does not support updates/deletes
  yet" (`src/platforms/registry.ts`).
- **Images on Threads/X**: not implemented. Both throw an explicit "local \<platform\> image
  publishing is not implemented yet" error if you try.
- **Message links** back to the published post: Telegram only for `@username` channels (not
  numeric chat ids), Discord only if a server id is configured, X always, Threads never.

## Scheduling

- A background worker polls for due scheduled posts, default every 15 seconds, configurable via
  `SCHEDULER_INTERVAL_MS` (`src/scheduler.ts`).
- Minimum lead time to schedule a post is 30 seconds from now (`src/scheduledPublications.ts`).
- A scheduled post can only be **canceled** while still pending — there is no in-place edit of a
  scheduled item's content; canceling and rescheduling is the only path in the UI.
- A scheduled post is read as its original author's draft but published under the **workspace's**
  platform credentials, so per-workspace Resources/settings apply even though the draft itself is
  private to whoever wrote it.

## Published history

- The composer's **Sent** tab shows per-target status (success/failure), channel name and icon, an
  open-in-platform link where available, and the error text for anything that failed
  (`frontend/src/components/PublishedTab.tsx`).
- A separate **Scheduled** page has *Upcoming* and *Archive* tabs; the archive shows how many of
  the original targets still succeeded (`okCount/total`) and lets a permitted user delete a whole
  published post across every channel it went to.

## Platforms

| | Telegram | Discord | Threads | X |
|---|---|---|---|---|
| Char limit | 4096 | 2000 | 500 | 280 |
| Update/delete | ✅ | ✅ | ❌ | ❌ |
| Image attachments | ✅ | ✅ | ❌ (not implemented) | ❌ (not implemented) |
| Channel discovery | ❌ manual only | ✅ (needs guild id) | Local profile only | Local profile only |
| Runs on | server | server | Composer Desktop | Composer Desktop |
| Silent/no-notify | ✅ | ✅ | n/a | n/a |
| Content validation | ✅ HTML tag check | ❌ | ❌ | ❌ |

Threads and X publish through a **local browser session inside Composer Desktop** rather than an
official API — the server enqueues a publish job and waits up to 55 seconds for the desktop client
to execute it (`src/localPublisherJobs.ts`). See [docs/desktop.md](desktop.md) and
[docs/platforms.md](platforms.md) for setup and connection details. No rate-limiting/cooldown logic
exists for either platform in the current code.

## Accounts & workspaces

- Sessions are JWTs (HS256) valid for 7 days (`src/auth.ts`).
- Registration issues a session immediately — **email verification is not required to use the
  app**, only before the account **owner** can invite workspace members
  (`src/invites.ts`, `requireVerifiedOwnerEmail`).
- Password reset, email change, and email verification links are all single-use, SHA-256-hashed at
  rest, with these lifetimes:
  - Password reset: 1 hour (`src/passwordReset.ts`)
  - Email change confirmation: 1 hour (`src/emailChange.ts`)
  - Registration email verification: 24 hours (`src/emailVerification.ts`)
  - Workspace invite: 7 days (`src/invites.ts`)
- **Single-membership model**: an account is either the owner of its own workspace, or an active
  member of exactly one *other* workspace — never both at once (`src/auth.ts`, enforced again on
  invite acceptance).
- **Permission flags** granted per invited member (`src/permissions.ts`):
  - `canPublish`, `canDelete`, `canManageChannels`, `canManageMembers`
  - `channelAccess`: either `'all'` or a specific list of Resource ids
  - A member can never grant another invitee more permissions than they themselves hold.

## Composer Desktop / local publishers

- **Pairing**: a 6-character code (`XXX-XXX` format) generated by the server, valid for 10 minutes
  (`src/localPublisherAgents.ts`). The desktop app exchanges it automatically through its Electron
  bridge — there's no manual code entry.
- **Heartbeat**: desktop sends one every 15 seconds; the server treats an agent as online for 45
  seconds after its last heartbeat. The heartbeat's platform list is restricted to `threads`/`x`
  only.
- **Job queue**: desktop polls for work every 2 seconds; a claimed job is leased for 60 seconds.
  Only `publish` jobs are handled — `update`/`delete` job types are not implemented on the desktop
  side either, consistent with the registry-level limitation above.
- Each platform's browser login lives in its own Electron session partition on the local machine,
  with a verification marker file and cookie checks confirming a real logged-in session
  (`desktop/src/browserPublisherSession.ts`, `browserPublisherSessionState.ts`). Cookies are never
  uploaded to the server.
- The desktop app supports multiple named server **environments** and can switch between them.
  Packaged (installed) builds only accept `https://` server URLs; plain `http://localhost` only
  works in an unpackaged dev build via `COMPOSER_DESKTOP_DEV_URL`.
