import TelegramBot from "node-telegram-bot-api";

// Accept a comma-separated list of channel usernames in the env variable
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const channelUsernamesEnv = process.env.TELEGRAM_CHANNEL_USERNAMES; // e.g. "@channel1,@channel2"

if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!channelUsernamesEnv) throw new Error("Missing TELEGRAM_CHANNEL_USERNAMES");

// Parse channel usernames into an array and trim whitespace
const channelUsernames = channelUsernamesEnv.split(",").map((c) => c.trim());

console.log(token, channelUsernames);

// Update callback type to accept images (array of file_ids)
let beforeSendCallback: (
  userId: number,
  text: string,
  images: string[]
) => void = () => {};

// Helper to format message with entities using HTML
function formatTextWithEntities(
  text: string,
  entities: TelegramBot.MessageEntity[] | undefined
): string {
  if (!entities || entities.length === 0) return text;

  const chars = [...text];
  const insertions: { index: number; value: string }[] = [];

  for (const entity of [...entities].reverse()) {
    const { offset, length, type, url } = entity;
    const start = offset;
    const end = offset + length;
    const content = chars.slice(start, end).join("");

    let formatted = content;

    switch (type) {
      case "bold":
        formatted = `<b>${content}</b>`;
        break;
      case "italic":
        formatted = `<i>${content}</i>`;
        break;
      case "code":
        formatted = `<code>${content}</code>`;
        break;
      case "pre":
        formatted = `<pre>${content}</pre>`;
        break;
      case "text_link":
        formatted = `<a href="${url}">${content}</a>`;
        break;
      case "underline":
        formatted = `<u>${content}</u>`;
        break;
      case "strikethrough":
        formatted = `<s>${content}</s>`;
        break;
      default:
        continue;
    }

    chars.splice(start, length, formatted);
  }

  return chars.join("");
}

/**
 * Initializes the Telegram bot and sets a callback to be called before sending messages to channels.
 * @param callback Function to call before sending a message to channels
 */
export function initTelegramBot(
  callback: (userId: number, text: string, images: string[]) => void
) {
  beforeSendCallback = callback;

  const bot = new TelegramBot(token, { polling: true });

  // Greet user on /start
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Прывітанне! Я бот.");
  });

  // Handle all messages except commands
  bot.on("message", async (msg) => {
    const userId = msg.chat.id;
    const text = msg.text || "";
    console.log(text, msg.document, msg.photo, msg.caption);

    const images: string[] = [];

    // Collect all photo file_ids if present
    if (msg.photo && msg.photo.length > 0) {
      for (const photo of msg.photo) {
        images.push(photo.file_id);
      }
    }

    // Ignore commands
    if (text && text.startsWith("/")) return;

    try {
      // Call the callback before sending to channels
      const caption = msg.caption
        ? formatTextWithEntities(msg.caption, msg.caption_entities)
        : formatTextWithEntities(text, msg.entities);
      beforeSendCallback(userId, caption, [images[images.length - 1]]);

      // Show typing action
      await bot.sendChatAction(userId, "typing");

      const parseMode = "HTML";

      if (images.length > 0) {
        const photoId = images[images.length - 1];
        const caption = msg.caption
          ? formatTextWithEntities(msg.caption, msg.caption_entities)
          : formatTextWithEntities(text, msg.entities);

        for (const channel of channelUsernames) {
          await bot.sendPhoto(channel, photoId, {
            caption,
            parse_mode: parseMode,
          });
        }
      } else if (text) {
        const formattedText = formatTextWithEntities(text, msg.entities);
        for (const channel of channelUsernames) {
          await bot.sendMessage(channel, formattedText, {
            parse_mode: parseMode,
          });
        }
      }

      // Confirm to the user
      await bot.sendMessage(userId, "Ваша паведамленне адпраўлена ў каналы.");
    } catch (err: any) {
      console.error("Error:", err);
      bot.sendMessage(userId, "Памылка: " + err.message);
    }
  });
}
