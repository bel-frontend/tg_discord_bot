import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import type { TextBasedChannel } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

export async function sendMessageToChannels(
  channelIds: string[],
  text?: string,
  imageUrls?: string[]
) {
  function htmlToDiscordMarkdown(html: string): string {
    return html
      .replace(/<b>(.*?)<\/b>/gi, "**$1**")
      .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<i>(.*?)<\/i>/gi, "*$1*")
      .replace(/<em>(.*?)<\/em>/gi, "*$1*")
      .replace(/<u>(.*?)<\/u>/gi, "__$1__")
      .replace(/<s>(.*?)<\/s>/gi, "~~$1~~")
      .replace(/<br\s*\/?>/gi, "\n");
  }

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        console.error(`Channel ${channelId} not found or is not text-based`);
        continue;
      }

      const markdownText = text ? htmlToDiscordMarkdown(text) : undefined;

      const messagePayload: {
        content?: string;
        files?: string[];
      } = {};

      if (markdownText) {
        messagePayload.content = markdownText;
      }

      if (imageUrls && imageUrls.length > 0) {
        messagePayload.files = imageUrls;
      }

      await (channel as TextBasedChannel).send(messagePayload);
    } catch (error) {
      console.error(
        `Error sending message to Discord channel ${channelId}:`,
        error
      );
    }
  }
}

client.once("ready", () => {
  if (client.user) {
    // console.log(`Logged in as ${client.user.tag}`);
    // sendMessageToChannels(chatIdsList, "Прывітанне! Я бот.");
  } else {
    console.log("Logged in, but client.user is null");
  }
});

client.login(TOKEN);
