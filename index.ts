import TelegramBot from "node-telegram-bot-api";
import { FileReader } from "./fileReader.js";

import { sendMessageToChannels } from "./discord";
import { initTelegramBot } from "./telegram";

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
  polling: false,
});
const fileReader = new FileReader(telegramBot);

console.log("Initializing bots...");

// Example callback function to be called before sending a message to Telegram channels
async function beforeTelegramSend(
  userId: number,
  text: string,
  fileIds: string[],
  telegramChunks?: string[]
) {
  async function getTelegramFileUrl(fileId: string): Promise<string> {
    const file = await telegramBot.getFile(fileId);
    return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  }

  const imageUrls = await Promise.all(fileIds.map(getTelegramFileUrl));
  console.log(imageUrls);

  // Check if Discord is configured before attempting to send
  const discordChannelIds = process.env.DISCORD_CHANNEL_IDS || "";
  const hasDiscordChannels = discordChannelIds.split(",").some((id) => id.trim());

  if (!hasDiscordChannels) {
    console.warn("No Discord channels configured - skipping Discord sending");
    return;
  }

  // Handle chunked text (from file processing)
  if (telegramChunks && telegramChunks.length > 0) {
    const extractedContent = { text: text, isFormatted: true };
    const discordChunks = fileReader.chunkText(extractedContent).discordChunks;
    sendMessageToChannels(undefined, imageUrls, discordChunks);
  } else {
    // Handle regular messages
    sendMessageToChannels(text, imageUrls);
  }
}

// Initialize Telegram bot and pass the callback
initTelegramBot(beforeTelegramSend);

console.log("Bots initialized.");
