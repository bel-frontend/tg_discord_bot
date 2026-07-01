export interface User {
    id: string;
    email: string;
}

export interface ChannelOption {
    platform: string;
    platformName: string;
    id: string;
    name: string;
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
    error?: string;
}

export type ToastKind = 'info' | 'success' | 'warn' | 'error';
