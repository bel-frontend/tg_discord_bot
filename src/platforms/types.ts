// The universal adapter contract. Adding a new social network = implement this + register it.

import type { PlatformSetup, PublishResult } from '../../shared/types';

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

export interface PlatformContext {
    userId?: string;
}

export interface ValidationIssue {
    platform: string;
    chunk: number;
    message: string;
    tag?: string;
    offset?: number;
    line?: number;
    excerpt?: string;
    htmlContext?: string;
}

export interface Platform {
    readonly id: string; // stable platform id used in targets and publications
    readonly name: string; // display name
    readonly icon?: string; // emoji/label for pickers; UI falls back to 🌐 when absent
    readonly charLimit?: number; // per-message length limit, shown as a UI hint
    readonly setup?: PlatformSetup; // displayed on the Settings page
    /** Whether the adapter has the config/tokens it needs to run. */
    isConfigured(): boolean;
    /** name -> id options for the channel picker. */
    listChannels(context?: PlatformContext): Promise<Channel[]>;
    /** Publish the same content to each of the given channel ids. */
    publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]>;
    /** Update previously published messages, when the platform can edit them. */
    update?(
        refs: PublishedMessageRef[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]>;
    /** Delete previously published messages, when the platform can delete them. */
    delete?(
        refs: PublishedMessageRef[],
        context?: PlatformContext,
    ): Promise<PublishResult[]>;
    /** Render markdown as this platform's preview HTML. */
    toPreviewHtml(markdown: string): string;
    /** Check markdown/content for platform-specific formatting problems. */
    validateContent?(markdown: string): ValidationIssue[];
    /** Build a link to a previously published message, or null when not linkable. */
    buildMessageLink?(channelId: string, messageId: string): string | null;
}
