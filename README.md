# tg_discord_bot

A simple bridge bot that forwards messages (including formatted text and images) from Telegram channels to Discord channels.  
Built with [Bun](https://bun.sh), [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api), and [discord.js](https://discord.js.org/).

---

## Features

- Forwards messages from specified Telegram channels to specified Discord channels.
- Preserves basic text formatting (bold, italic, underline, strikethrough) by converting Telegram HTML to Discord Markdown.
- Supports forwarding images/photos.
- Easy configuration via environment variables.

---

## Prerequisites

- [Bun](https://bun.sh/) (v1.1.26 or newer recommended)
- Discord bot token and channel IDs
- Telegram bot token and channel usernames

---

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/bel-frontend/tg_discord_bot.git
   cd tg_discord_bot
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

---

## Configuration

Create a `.env` file in the project root with the following variables:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_IDS=channel_id1,channel_id2
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHANNEL_USERNAMES=@channel1,@channel2
```

- `DISCORD_BOT_TOKEN`: Your Discord bot token (see [Discord Developer Portal](https://discord.com/developers/applications)).
- `DISCORD_CHANNEL_IDS`: Comma-separated list of Discord channel IDs to forward messages to.
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token (get from [@BotFather](https://t.me/BotFather)).
- `TELEGRAM_CHANNEL_USERNAMES`: Comma-separated list of Telegram channel usernames (with `@`).

---

## Usage

Start the bot with:

```bash
bun run index.ts
```

The bot will listen for messages in the specified Telegram channels and forward them (with formatting and images) to the specified Discord channels.

---

## How It Works

- **Telegram Side:**  
  The bot listens for new messages in the configured Telegram channels. When a message is received, it extracts the text (with formatting) and any attached images.
- **Formatting:**  
  Telegram formatting (HTML tags like `<b>`, `<i>`, etc.) is converted to Discord Markdown (`**bold**`, `*italic*`, etc.) before sending.
- **Discord Side:**  
  The bot sends the formatted message and any images to all configured Discord channels.

---

## File Structure

- `index.ts` — Entry point; initializes both bots and sets up the forwarding logic.
- `telegram.ts` — Handles Telegram bot logic and message formatting.
- `discord.ts` — Handles Discord bot logic and HTML-to-Markdown conversion.
- `README.md` — This documentation.

---

## Example

**Telegram message:**

```
<b>Hello</b> <i>world</i>!
```

**Discord output:**

```
**Hello** *world*!
```

---

## Troubleshooting

- Make sure all environment variables are set correctly.
- The Discord bot must be invited to your server and have permission to send messages in the target channels.
- The Telegram bot must be an admin in the source channels.

---

## License

MIT

---

## Credits

- [discord.js](https://discord.js.org/)
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- [Bun](https://bun.sh)
