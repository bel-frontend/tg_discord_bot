import {
  Client,
  GatewayIntentBits,
  ChannelType,
  MessageFlags,
} from "discord.js";
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

const channelIdsEnv = process.env.DISCORD_CHANNEL_IDS || "";

const channelIds = channelIdsEnv.split(",").map((c) => c.trim());

export async function sendMessageToChannels(
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

client.on("messageCreate", async (message) => {
  console.log("Message received:", message.content);
  const userId = message.author.id;
  // 1. Check if it's a direct message (DM)
  const isDirect = message.channel.type === ChannelType.DM;

  // 2. Check if the bot is mentioned in a guild message
  const isMention = message.mentions.has(client.user?.id || "");

  if (isDirect) {
    console.log("User wrote to the bot directly (DM)");
  } else if (isMention) {
    console.log("User mentioned the bot in a server");
  } else {
    console.log("Message is not a DM or mention");
    return; // Optionally ignore
  }

  if (message.author.bot) return;
  console.log("User ID:", userId);
  const channelId = message.channel.id;

  console.log("Channel ID:", channelId);

  message.channel.send({
    content:
      "channelId: " +
      channelId +
      " userId: " +
      userId +
      " message: " +
      message.content,

    flags: MessageFlags.SuppressNotifications,
  });

  if (message.author.bot) return;
});
