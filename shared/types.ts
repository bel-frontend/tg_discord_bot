// Wire-shape types shared between the backend (src/) and frontend (frontend/src/).
// Only types that actually cross the HTTP/JSON boundary belong here — Mongo document
// shapes (ObjectId, Date fields) and backend-adapter-internal contracts stay local.

export interface User {
    id: string;
    email: string;
}

export type MemberPermissions = {
    // channelResource ids this member may target when publishing/scheduling.
    channelAccess: 'all' | string[];
    canPublish: boolean;
    canDelete: boolean;
    canManageChannels: boolean;
    canManageMembers: boolean;
};

export const FULL_ACCESS_PERMISSIONS: MemberPermissions = {
    channelAccess: 'all',
    canPublish: true,
    canDelete: true,
    canManageChannels: true,
    canManageMembers: true,
};

export type AccountMemberStatus = 'invited' | 'active' | 'revoked';

export interface MemberSummary {
    id: string;
    email: string;
    status: AccountMemberStatus;
    permissions: MemberPermissions;
    invitedAt: string;
    acceptedAt?: string;
}

export interface Me {
    user: User;
    accountId: string;
    role: 'owner' | 'member';
    permissions: MemberPermissions;
    emailVerified: boolean;
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
    configFields?: PlatformConfigField[];
    // Steps/notes may embed a link as "[label](https://...)"; the UI renders it inline
    // where it's mentioned instead of listing links separately out of context. The
    // Resources-page ID format belongs inline in the step that tells the user to add
    // it there, not as a separate section repeating the same thing out of context.
    steps: string[];
    docsUrl?: string;
    notes?: string[];
}

export interface PlatformConfigField {
    name: string;
    label: string;
    required: boolean;
    secret?: boolean;
    description: string;
    placeholder?: string;
}

export interface PlatformConfigStatus {
    platform: string;
    values: Record<string, string>;
    configuredSecrets: string[];
    updatedAt?: string;
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
