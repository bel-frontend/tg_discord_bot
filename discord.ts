import {
    Client,
    GatewayIntentBits,
    ChannelType,
    MessageFlags,
} from 'discord.js';
import type { TextBasedChannel } from 'discord.js';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
});

const channelIdsEnv = process.env.DISCORD_CHANNEL_IDS || '';
const channelIds = channelIdsEnv.split(',').map((c) => c.trim());

// Канвертацыя HTML у Discord Markdown
function htmlToDiscordMarkdown(html: string): string {
    const nhm = new NodeHtmlMarkdown({
        strongDelimiter: '**',
        emDelimiter: '*',
        codeBlockStyle: 'fenced',
        bulletMarker: '•',
        headingStyle: 'atx',
        hr: '---',
        br: '\n', // УВАГА: толькі адзін перанос
        keepDataImages: false,
        useLinkReferenceDefinitions: false,
        useInlineLinks: true,
        blockElements: [
            'p',
            'div',
            'blockquote',
            'pre',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'ul',
            'ol',
            'li',
            'table',
            'thead',
            'tbody',
            'tr',
            'th',
            'td',
        ],
    } as any);
    function cleanUpMarkdown(md: string): string {
        return md
            .replace(/•(?=\S)/g, '• ') // Дадае прабел пасля bullet
            .replace(/\*\*(.+?)\*\*(?=\S)/g, '**$1**\n') // Падзел пасля загалоўкаў
            .trim();
    }
    const cleanedHtml = html.replaceAll(/\n/g, '<br/>');
    const  md  =  nhm.translate(cleanedHtml);
    return cleanUpMarkdown(md);
}

export async function sendMessageToChannels(
    text?: string,
    imageUrls?: string[],
    discordChunks?: string[],
) {
    if (!channelIds.length || channelIds.every((id) => !id.trim())) {
        console.warn(
            'No Discord channels configured - skipping Discord sending',
        );
        return;
    }

    for (const channelId of channelIds) {
        if (!channelId || !channelId.trim()) {
            console.warn('Empty Discord channel ID found - skipping');
            continue;
        }

        try {
            const channel = await client.channels.fetch(channelId.trim());
            if (!channel?.isTextBased()) {
                console.warn(
                    `Discord channel ${channelId} not found or is not text-based - skipping`,
                );
                continue;
            }

            if (discordChunks && discordChunks.length > 0) {
                for (let i = 0; i < discordChunks.length; i++) {
                    const chunkHeader =
                        discordChunks.length > 1
                            ? `📄 Part ${i + 1}/${discordChunks.length}\n\n`
                            : '';

                    const convertedChunk = htmlToDiscordMarkdown(
                        discordChunks[i],
                    );

                    const messagePayload: {
                        content: string;
                        files?: string[];
                    } = {
                        content: chunkHeader + convertedChunk,
                    };

                    if (imageUrls && imageUrls.length > 0 && i === 0) {
                        messagePayload.files = imageUrls;
                    }

                    await (channel as any).send(messagePayload);
                }
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

            await (channel as any).send(messagePayload);
        } catch (error: any) {
            if (
                error.code === 10003 ||
                error.code === 50001 ||
                error.code === 50013
            ) {
                console.warn(
                    `Discord channel ${channelId} not accessible (${error.message}) - skipping`,
                );
            } else {
                console.error(
                    `Error sending message to Discord channel ${channelId}:`,
                    error,
                );
            }
            continue;
        }
    }
}

// Аўтэнтыфікацыя і апрацоўка падзей
client.once('ready', () => {
    if (client.user) {
        console.log(`Logged in as ${client.user.tag}`);
    } else {
        console.log('Logged in, but client.user is null');
    }
});

client.login(TOKEN);

client.on('messageCreate', async (message) => {
    console.log('Message received:', message.content);
    const userId = message.author.id;
    const isDirect = message.channel.type === ChannelType.DM;
    const isMention = message.mentions.has(client.user?.id || '');

    if (message.author.bot) return;

    if (isDirect) {
        console.log('User wrote to the bot directly (DM)');
    } else if (isMention) {
        console.log('User mentioned the bot in a server');
    } else {
        console.log('Message is not a DM or mention');
        return;
    }

    const channelId = message.channel.id;
    console.log('User ID:', userId);
    console.log('Channel ID:', channelId);

    message.channel.send({
        content:
            'channelId: ' +
            channelId +
            ' userId: ' +
            userId +
            ' message: ' +
            message.content,
        flags: MessageFlags.SuppressNotifications,
    });
});
