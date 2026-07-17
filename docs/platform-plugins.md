# Platform plugin specification

A platform is a self-contained folder under `src/platforms/`. At startup the loader
(`src/platforms/loader.ts`) scans that directory, imports every platform folder, and registers it —
dropping a new folder in is all it takes to add a platform. No edits to `index.ts`, the server, or
the frontend are needed: the Settings form, channel picker, and icons all render from the metadata
the platform declares about itself.

This page is the contract such a folder must satisfy. `src/platforms/bluesky/` is the reference
implementation.

## Folder layout

```
src/platforms/<id>/
├── index.ts          # required — the entry module (see below)
├── markdown.ts       # convention — markdown → platform format conversion
└── *.test.ts         # colocated tests, run by `bun run test`
```

- The folder name should equal the platform `id`.
- `markdown.ts` holds the markdown conversion when the platform's output format differs from raw
  markdown (Telegram HTML, Discord markdown, plain text with facets, …). Keep it separate from the
  adapter so it stays unit-testable without network mocks.

## Entry contract

`index.ts` must export a factory:

```ts
export function createPlatform(): Platform;
```

The returned object must satisfy the `Platform` interface from `src/platforms/types.ts`.

Loader behavior:

- Directories without an `index.ts`, without a `createPlatform` export, or whose factory throws or
  returns an invalid object are **skipped with a console warning** — one broken plugin never takes
  the server down.
- The loader runtime-validates the result: non-empty `id` and `name`, and `isConfigured`,
  `listChannels`, `publish`, `toPreviewHtml` present as functions.
- A **duplicate platform id throws** at startup — that's a programmer error, not a runtime
  condition.
- Folders load in alphabetical order, so registration (and platform listing order) is
  deterministic.
- The loader imports folders dynamically at runtime, which relies on Bun running TypeScript from
  source (`bun run index.ts`). If the server is ever bundled with `bun build`, directory scanning
  will need a build-time manifest instead.

## Platform members

Required:

| Member | Semantics |
| --- | --- |
| `id` | Stable identifier stored in targets and publications. Never change it once shipped. |
| `name` | Display name shown across the UI. |
| `isConfigured()` | Whether server-wide (env/constructor) config exists. Return `false` for platforms whose credentials are purely per-workspace. |
| `listChannels(context)` | Channel options for the picker. Runs on **every** picker load — keep it cheap and avoid network calls; return `[]` when the workspace has no credentials. |
| `publish(channelIds, content, context)` | Publish the same content to each channel id. Return one `PublishResult` per channel; catch per-channel failures and report them in the result — only throw for whole-platform failures (missing credentials, invalid content). |
| `toPreviewHtml(markdown)` | Render the composer preview for this platform. |

Optional:

| Member | Semantics |
| --- | --- |
| `icon` | Emoji/label for pickers; UI falls back to 🌐. |
| `charLimit` | Per-message length limit, shown as a UI hint. |
| `desktopOnly` | Only exposed to Composer Desktop; hidden and rejected in the web client. |
| `setup` | Settings-page metadata (see Credentials below). |
| `update(refs, content, context)` | Edit published messages. Omit it when the platform can't edit (e.g. Bluesky) — the registry then returns a clean "does not support updates yet" error. |
| `delete(refs, context)` | Delete published messages; same omission rule. |
| `validateContent(markdown)` | Pre-publish warnings (formatting problems, will-be-threaded notices). |
| `buildMessageLink(channelId, messageId)` | **Stateless** link building only — it may not use per-workspace state. When a link needs session data (a handle, a guild id), set `link` on the `PublishResult` inside `publish()` instead; the registry never overrides a link the adapter already set. |

The `messageIds` you return from `publish` are stored verbatim and round-trip back into
`update`/`delete` — pick a format that carries everything those operations need (Bluesky stores
full `at://` URIs for exactly this reason).

## Credentials

Declare per-workspace credentials as `setup.configFields` (see `PlatformConfigField` in
`shared/types.ts`):

- Field names are `UPPER_SNAKE_CASE`, conventionally prefixed with the platform id
  (`BLUESKY_APP_PASSWORD`).
- Mark tokens/passwords `secret: true` — secret values are never sent back to the client.
- The Settings page renders the form, steps, and notes entirely from `setup`; there is no
  platform-specific frontend code.

Read credentials at operation time with
`getPlatformConfigValues(context?.accountId, this.id)` (`src/platformConfigs.ts`). Never cache
credentials across workspaces; if you cache sessions, key them by account id and invalidate when
the stored credentials change (see the session cache in `src/platforms/bluesky/index.ts`).

Platforms that publish through a local browser session instead (Threads, X) set
`desktopOnly = true` and `setup.connect = 'desktop-browser'`.

## Isolation rule

A platform folder owns its authentication, channel discovery, publishing, updating, deleting,
chunking constraints, and format conversion. It may depend only on:

- `src/platforms/types.ts` and `shared/types.ts`
- the registry API (`src/platforms/registry.ts`)
- shared utilities: `src/chunk.ts`, `src/platformConfigs.ts`

Never import from another platform's folder. If two platforms need the same helper, copy it or
promote it to a shared module — don't cross-import.

## Testing expectations

- Colocate tests in the platform folder; `bun run test` picks up `src/platforms/*/*.test.ts`.
- Mock the network client by injecting it through the constructor (Telegram takes a token,
  Bluesky takes an `agentFactory`) rather than `mock.module`, which leaks across the whole test
  run.
- Cover at minimum: markdown conversion, unconfigured behavior, publish success and per-channel
  failure, chunking/threading past `charLimit`, and `update`/`delete` if implemented.
