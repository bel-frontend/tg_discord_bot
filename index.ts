import TelegramBot from "node-telegram-bot-api";

import { sendMessageToChannels } from "./discord";
import { initTelegramBot } from "./telegram";

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {
  polling: false,
});
console.log("Initializing bots...");

// Example callback function to be called before sending a message to Telegram channels
async function beforeTelegramSend(
  userId: number,
  text: string,
  fileIds: string[]
) {
  async function getTelegramFileUrl(fileId: string): Promise<string> {
    const file = await telegramBot.getFile(fileId);
    return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  }

  const imageUrls = await Promise.all(fileIds.map(getTelegramFileUrl));
  console.log(imageUrls);

  sendMessageToChannels(
    ["1374368491771002970"], // lepro channel
    text,
    imageUrls
  );
}

// Initialize Telegram bot and pass the callback
initTelegramBot(beforeTelegramSend);

console.log("Bots initialized.");
