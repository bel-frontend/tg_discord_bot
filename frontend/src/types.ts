export interface User {
    id: string;
    email: string;
}

export interface ChannelOption {
    platform: string;
    platformName: string;
    id: string;
    name: string;
    resourceId?: string;
    source?: 'db' | 'config';
}

export interface Target {
    platform: string;
    channelId: string;
}

export interface Draft {
    id: string;
    title: string;
    markdown: string;
    imageUrls: string[];
    imageIds: string[];
    targets: Target[];
    createdAt: string;
    updatedAt: string;
}

export interface PublishResult {
    platform: string;
    channelId: string;
    ok: boolean;
    messageIds?: string[];
    error?: string;
}

export interface PublicationTarget {
    platform: string;
    channelId: string;
    messageIds: string[];
    ok: boolean;
    error?: string;
    updatedAt: string;
}

export interface Publication {
    id: string;
    draftId: string;
    title: string;
    markdown: string;
    imageUrls: string[];
    targets: PublicationTarget[];
    createdAt: string;
    updatedAt: string;
}

export type ToastKind = 'info' | 'success' | 'warn' | 'error';
