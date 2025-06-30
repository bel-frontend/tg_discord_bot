import TelegramBot from "node-telegram-bot-api";
import { FileReader } from "./fileReader.js";

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const channelUsernamesEnv = process.env.TELEGRAM_CHANNEL_USERNAMES;

if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!channelUsernamesEnv) throw new Error("Missing TELEGRAM_CHANNEL_USERNAMES");

const channelUsernames = channelUsernamesEnv.split(",").map((c) => c.trim());

let beforeSendCallback: (
  userId: number,
  text: string,
  images: string[],
  telegramChunks?: string[]
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
  callback: (userId: number, text: string, images: string[], telegramChunks?: string[]) => void
) {
  beforeSendCallback = callback;
  const bot = new TelegramBot(token, { polling: true });
  const fileReader = new FileReader(bot);

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Прывітанне! Я бот.");
  });

  bot.on("message", async (msg) => {
    const userId = msg.chat.id;
    const text = msg.text || "";
    const images = msg.photo?.map((p) => p.file_id) || [];

    if (text.startsWith("/")) return;

    try {
      // Handle document files
      if (msg.document) {
        const fileName = msg.document.file_name || "";
        const fileId = msg.document.file_id;
        
        if (fileName.toLowerCase().endsWith('.txt') || fileName.toLowerCase().endsWith('.pdf')) {
          await bot.sendChatAction(userId, "typing");
          
          try {
            const extractedContent = await fileReader.extractTextFromFile(fileId, fileName);
            const chunkedText = fileReader.chunkText(extractedContent);
            
            // Send to callback with chunks
            beforeSendCallback(userId, extractedContent.text, [], chunkedText.telegramChunks);
            
            // Send chunks to Telegram channels
            for (const channel of channelUsernames) {
              for (let i = 0; i < chunkedText.telegramChunks.length; i++) {
                const chunkHeader = chunkedText.telegramChunks.length > 1 ? `` : ``;
                await bot.sendMessage(channel, chunkHeader + chunkedText.telegramChunks[i], {
                  parse_mode: "HTML",
                });
              }
            }
            
            await bot.sendMessage(userId, `Файл "${fileName}" апрацаваны і адпраўлены ў каналы (${chunkedText.telegramChunks.length} частак).`);
            return;
          } catch (error) {
            console.error("File processing error:", error);
            await bot.sendMessage(userId, `Памылка апрацоўкі файла: ${error instanceof Error ? error.message : 'Невядомая памылка'}`);
            return;
          }
        } else {
          await bot.sendMessage(userId, "Падтрымліваюцца толькі файлы .txt і .pdf");
          return;
        }
      }

      // Handle regular messages (existing logic)
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
