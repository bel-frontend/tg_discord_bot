# Platforms

Each platform is an adapter under `src/platforms/` implementing the `Platform` interface
(`src/platforms/types.ts`). This page covers how to connect each shipped platform, and how to add
a new one.

## Telegram

Publishes through a Telegram bot added to each target channel or chat (`src/platforms/telegram.ts`).

1. Open [BotFather](https://t.me/BotFather) in Telegram, send `/newbot`, and follow the prompts to
   create a bot.
2. Copy the token BotFather gives you, paste it into **Settings → Telegram → Bot token**, and
   save.
3. Add the bot to the channel or group you want to post to, and give it permission to post
   messages.
4. Go to **Resources** and add that channel/group as a Telegram resource — use its `@username`
   (e.g. `@public_channel`), or a numeric chat id (e.g. `-1001234567890`) for private
   channels/chats.
5. It now shows up in the channel picker whenever you publish or schedule a post.

Telegram bots can't list every channel they belong to, so each target must be added manually on
the Resources page. Docs: <https://core.telegram.org/bots>.

## Discord

Publishes through a Discord bot installed in your server with message permissions
(`src/platforms/discord.ts`).

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications)
   and add a bot to it.
2. Copy the bot token and paste it into **Settings → Discord → Bot token**, then save.
3. Invite the bot to your server with permission to view channels and send messages.
4. (Optional) Copy your server (guild) id and paste it into **Server id** in the same settings
   panel, so successful posts get a link back to the message.
5. Enable Developer Mode in Discord, right-click the target channel to copy its id, then go to
   **Resources** and add it as a Discord resource.

The bot can only publish to text channels it can see and where it has Send Messages permission.
Docs: <https://discord.com/developers/docs/intro>.

## Threads and X

Threads and X have no official public posting API usable here, so both are `desktopOnly`
platforms (`src/platforms/threads.ts`, `src/platforms/x.ts`): they publish through a private
browser session that lives inside **Composer Desktop**, on your own computer, not on the server.
See [docs/desktop.md](desktop.md) for how to install Composer Desktop, pair it with your
workspace, and connect each platform.

- Threads posts are limited to 500 characters.
- X posts over 280 characters are published as a reply thread.
- Composer Desktop must be running and connected for a Threads/X publish to succeed; otherwise the
  publish attempt fails with an error.

## Adding a new platform

1. Implement the `Platform` interface (`src/platforms/types.ts`): `id`, `name`, `isConfigured()`,
   `listChannels()`, `publish()`, and `toPreviewHtml()` at minimum. Add `update()`/`delete()` if
   the platform supports editing/removing a published message, and `validateContent()` /
   `buildMessageLink()` if useful.
2. Add the adapter under `src/platforms/<name>.ts`, with Markdown conversion in
   `src/platforms/<name>/markdown.ts` if the platform needs a distinct output format.
3. Register the instance in `index.ts` — no server or frontend changes are needed beyond that; the
   platform shows up in the channel picker and Settings automatically from its `setup` metadata.
4. If the platform needs per-workspace credentials (like Telegram/Discord), declare `setup.configFields`
   and `setup.steps` on the class — this is what renders the Settings form and instructions. If it
   needs a local browser session instead (like Threads/X), set `desktopOnly = true` and
   `setup.connect = 'desktop-browser'`.
5. Add tests for chunking, Markdown conversion, publish/update/delete request handling, and
   registry behavior for anything shared-logic-affecting.

Keep every platform integration self-contained: a platform module owns its own
authentication/client setup, channel discovery, publishing, updating, deleting, chunking
constraints, and format conversion. Platform modules should not depend on another platform's
internals — only on the shared `Platform` contract, `shared/types`, and the registry API
(`src/platforms/registry.ts`).
