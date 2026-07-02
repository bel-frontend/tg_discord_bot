// The universal adapter contract. Adding a new social network = implement this + register it.

import type { PublishResult } from '../../shared/types';

export type { PublishResult };

export interface Channel {
    id: string; // real platform channel id (used when publishing)
    name: string; // human-readable label (shown in the UI)
}

export interface PublishImage {
    data: Uint8Array;
    filename: string;
    contentType?: string;
}

export interface PublishContent {
    markdown: string;
    imageUrls?: string[]; // remote image URLs
    images?: PublishImage[]; // uploaded image bytes to send as attachments
}

export interface PublishedMessageRef {
    channelId: string;
    messageIds: string[];
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
    /** Update previously published messages, when the platform can edit them. */
    update?(
        refs: PublishedMessageRef[],
        content: PublishContent,
    ): Promise<PublishResult[]>;
    /** Delete previously published messages, when the platform can delete them. */
    delete?(refs: PublishedMessageRef[]): Promise<PublishResult[]>;
}
