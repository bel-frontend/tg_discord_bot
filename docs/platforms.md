# Platforms

Each platform is a self-contained folder under `src/platforms/` implementing the `Platform`
interface (`src/platforms/types.ts`), discovered and registered automatically at startup. This
page covers how to connect each shipped platform, and how to add a new one.

## Telegram

Publishes through a Telegram bot added to each target channel or chat (`src/platforms/telegram/`).

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
(`src/platforms/discord/`).

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

## Bluesky

Publishes to your Bluesky account over the AT Protocol using an app password
(`src/platforms/bluesky/`).

1. Open [App Passwords](https://bsky.app/settings/app-passwords) in your Bluesky settings and
   create a new app password.
2. Paste your handle (e.g. `you.bsky.social`) and the app password into
   **Settings → Bluesky**, then save. Use the **Service URL** field only if you run your own PDS;
   it defaults to `https://bsky.social`.
3. Your account shows up in the channel picker as a Bluesky channel — no Resources entry needed.

- Posts are limited to 300 characters; longer posts are published as a reply thread, with any
  images attached to the first post (at most 4 images, up to 1 MB each).
- Bluesky does not support editing, so published posts cannot be updated afterwards — deleting a
  publication removes the whole thread.
- Use an app password, never your account password; repeated failed logins can temporarily
  rate-limit the account.

## Threads and X

Threads and X have no official public posting API usable here, so both are `desktopOnly`
platforms (`src/platforms/threads/`, `src/platforms/x/`): they publish through a private
browser session that lives inside **Composer Desktop**, on your own computer, not on the server.
See [docs/desktop.md](desktop.md) for how to install Composer Desktop, pair it with your
workspace, and connect each platform.

- Threads posts are limited to 500 characters.
- X posts over 280 characters are published as a reply thread.
- Composer Desktop must be running and connected for a Threads/X publish to succeed; otherwise the
  publish attempt fails with an error.

## Adding a new platform

Drop a folder into `src/platforms/<id>/` whose `index.ts` exports
`createPlatform(): Platform` — it is discovered and registered automatically at startup, and shows
up in the channel picker and Settings with no server or frontend changes. The full folder
contract (required members, credentials, isolation and testing rules) is in
[docs/platform-plugins.md](platform-plugins.md); `src/platforms/bluesky/` is the reference
implementation.
