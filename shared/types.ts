// Wire-shape types shared between the backend (src/) and frontend (frontend/src/).
// Only types that actually cross the HTTP/JSON boundary belong here — Mongo document
// shapes (ObjectId, Date fields) and backend-adapter-internal contracts stay local.

export interface User {
    id: string;
    email: string;
}

export interface Target {
    platform: string;
    channelId: string;
}

export interface ChannelOption {
    platform: string; // platform id
    platformName: string; // platform display name
    id: string; // channel id
    name: string; // channel name
    resourceId?: string; // db document id (only for DB-managed channels)
    source?: 'db' | 'config';
}

export interface PlatformMeta {
    id: string;
    name: string;
    icon?: string;
    charLimit?: number;
    setup?: PlatformSetup;
}

export interface PlatformSetup {
    summary: string;
    env: PlatformSetupEnvVar[];
    channelIdLabel: string;
    channelIdHelp: string;
    steps: string[];
    docsUrl?: string;
    notes?: string[];
}

export interface PlatformSetupEnvVar {
    name: string;
    required: boolean;
    description: string;
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
    link?: string;
}

export interface PublicationTarget {
    platform: string;
    channelId: string;
    messageIds: string[];
    ok: boolean;
    error?: string;
    updatedAt: string;
    link?: string;
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

export type ScheduledPublicationStatus =
    | 'scheduled'
    | 'publishing'
    | 'published'
    | 'failed'
    | 'cancelled';

export interface ScheduledPublication {
    id: string;
    draftId: string;
    title: string;
    scheduledAt: string;
    status: ScheduledPublicationStatus;
    error?: string;
    results?: PublishResult[];
    publicationId?: string;
    createdAt: string;
    updatedAt: string;
}
