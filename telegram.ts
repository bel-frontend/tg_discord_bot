import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const channelUsernamesEnv = process.env.TELEGRAM_CHANNEL_USERNAMES;

if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!channelUsernamesEnv) throw new Error("Missing TELEGRAM_CHANNEL_USERNAMES");

const channelUsernames = channelUsernamesEnv.split(",").map((c) => c.trim());

let beforeSendCallback: (
  userId: number,
  text: string,
  images: string[]
) => void = () => {};

function formatTextWithEntities(
  text: string,
  entities: TelegramBot.MessageEntity[] | undefined
): string {
  if (!entities?.length) return text;

  const chars = [...text];

  for (const entity of [...entities].reverse()) {
    const { offset, length, type, url } = entity;
    const content = chars.slice(offset, offset + length).join("");

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
    }

    chars.splice(offset, length, formatted);
  }

  return chars.join("");
}

export function initTelegramBot(
  callback: (userId: number, text: string, images: string[]) => void
) {
  beforeSendCallback = callback;
  const bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Прывітанне! Я бот.");
  });

  bot.on("message", async (msg) => {
    const userId = msg.chat.id;
    const text = msg.text || "";
    const images = msg.photo?.map((p) => p.file_id) || [];

    if (text.startsWith("/")) return;

    try {
      const formattedText = msg.caption
        ? formatTextWithEntities(msg.caption, msg.caption_entities)
        : formatTextWithEntities(text, msg.entities);

      const photoId = images.at(-1) || null;
      beforeSendCallback(userId, formattedText, photoId ? [photoId] : []);

      await bot.sendChatAction(userId, "typing");

      const parseMode = "HTML";

      if (photoId) {
        for (const channel of channelUsernames) {
          await bot.sendPhoto(channel, photoId, {
            caption: formattedText,
            parse_mode: parseMode,
          });
        }
      } else if (text) {
        for (const channel of channelUsernames) {
          await bot.sendMessage(channel, formattedText, {
            parse_mode: parseMode,
          });
        }
      }

      await bot.sendMessage(userId, "Ваша паведамленне адпраўлена ў каналы.");
    } catch (err: any) {
      console.error("Error:", err);
      await bot.sendMessage(userId, "Памылка: " + err.message);
    }
  });
}
