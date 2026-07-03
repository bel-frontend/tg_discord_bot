import type { PlatformConfigStatus } from '../shared/types';
import { platformConfigs } from './db';
import { getPlatform, listPlatforms } from './platforms/registry';

function normalizePlatform(platform: string): string {
    return platform.trim().toLowerCase();
}

function allowedFields(platform: string) {
    return getPlatform(platform)?.setup?.configFields ?? [];
}

function serializeConfig(
    platform: string,
    values: Record<string, string>,
    updatedAt?: Date,
): PlatformConfigStatus {
    const fields = allowedFields(platform);
    const secretNames = new Set(
        fields.filter((field) => field.secret).map((field) => field.name),
    );
    return {
        platform,
        values: Object.fromEntries(
            Object.entries(values).filter(([name]) => !secretNames.has(name)),
        ),
        configuredSecrets: Object.entries(values)
            .filter(([name, value]) => secretNames.has(name) && Boolean(value))
            .map(([name]) => name),
        updatedAt: updatedAt?.toISOString(),
    };
}

export async function getPlatformConfigValues(
    userId: string | undefined,
    platformId: string,
): Promise<Record<string, string>> {
    if (!userId) return {};
    const doc = await platformConfigs().findOne({
        userId,
        platform: normalizePlatform(platformId),
    });
    return doc?.values ?? {};
}

export async function listPlatformConfigs(
    userId: string,
): Promise<PlatformConfigStatus[]> {
    const docs = await platformConfigs().find({ userId }).toArray();
    const byPlatform = new Map(docs.map((doc) => [doc.platform, doc]));
    return listPlatforms().map((platform) => {
        const doc = byPlatform.get(platform.id);
        return serializeConfig(platform.id, doc?.values ?? {}, doc?.updatedAt);
    });
}

export async function upsertPlatformConfig(
    userId: string,
    platformId: string,
    input: unknown,
): Promise<PlatformConfigStatus> {
    const platform = normalizePlatform(platformId);
    const fields = allowedFields(platform);
    if (!fields.length) throw new Error('Platform is not configurable');
    if (!input || typeof input !== 'object') {
        throw new Error('Invalid platform settings');
    }

    const current = await getPlatformConfigValues(userId, platform);
    const next = { ...current };
    const body = input as Record<string, unknown>;

    for (const field of fields) {
        if (!(field.name in body)) continue;
        const value = String(body[field.name] ?? '').trim();
        if (field.secret && !value && current[field.name]) continue;
        if (value) next[field.name] = value;
        else delete next[field.name];
    }

    for (const field of fields) {
        if (field.required && !next[field.name]) {
            throw new Error(`${field.label} is required`);
        }
    }

    const now = new Date();
    const result = await platformConfigs().findOneAndUpdate(
        { userId, platform },
        {
            $set: {
                values: next,
                updatedAt: now,
            },
            $setOnInsert: {
                userId,
                platform,
                createdAt: now,
            },
        },
        { upsert: true, returnDocument: 'after' },
    );

    return serializeConfig(platform, result?.values ?? next, result?.updatedAt ?? now);
}
