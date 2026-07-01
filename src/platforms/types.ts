// The universal adapter contract. Adding a new social network = implement this + register it.

export interface Channel {
    id: string; // real platform channel id (used when publishing)
    name: string; // human-readable label (shown in the UI)
}

export interface PublishContent {
    markdown: string;
    imageUrls?: string[];
}

export interface PublishResult {
    platform: string;
    channelId: string;
    ok: boolean;
    error?: string;
}

export interface Platform {
    readonly id: string; // "telegram" | "discord" | ...
    readonly name: string; // display name
    /** Whether the adapter has the config/tokens it needs to run. */
    isConfigured(): boolean;
    /** name -> id options for the channel picker. */
    listChannels(): Promise<Channel[]>;
    /** Publish the same content to each of the given channel ids. */
    publish(
        channelIds: string[],
        content: PublishContent,
    ): Promise<PublishResult[]>;
}
