import { normalizeThreadsPostUrl } from './post';

export interface CreatedThreadsPost {
    messageId: string;
    link: string;
}

function normalizedText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsText(value: unknown, expected: string): boolean {
    if (typeof value === 'string') {
        return normalizedText(value).includes(expected);
    }
    if (Array.isArray(value)) {
        return value.some((item) => containsText(item, expected));
    }
    return (
        isRecord(value) &&
        Object.values(value).some((item) => containsText(item, expected))
    );
}

function findStringField(
    value: unknown,
    names: Set<string>,
): string | undefined {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findStringField(item, names);
            if (found) return found;
        }
        return undefined;
    }
    if (!isRecord(value)) return undefined;
    for (const [name, item] of Object.entries(value)) {
        if (names.has(name) && typeof item === 'string' && item.trim()) {
            return item.trim();
        }
    }
    for (const item of Object.values(value)) {
        const found = findStringField(item, names);
        if (found) return found;
    }
    return undefined;
}

function fromLink(value: string): CreatedThreadsPost | undefined {
    try {
        const link = normalizeThreadsPostUrl(value);
        const messageId = link.match(/\/post\/([^/?]+)/)?.[1];
        return messageId ? { messageId, link } : undefined;
    } catch {
        return undefined;
    }
}

function candidateFromRecord(
    record: Record<string, unknown>,
    expected: string,
): CreatedThreadsPost | undefined {
    if (!containsText(record, expected)) return undefined;

    const permalink = findStringField(
        record,
        new Set(['permalink', 'post_url', 'share_url']),
    );
    if (permalink) {
        const candidate = fromLink(permalink);
        if (candidate) return candidate;
    }

    const code = findStringField(
        record,
        new Set(['code', 'shortcode', 'media_code']),
    );
    const username = findStringField(record, new Set(['username']));
    if (!code || !username || !/^[A-Za-z0-9_-]+$/.test(code)) {
        return undefined;
    }
    return fromLink(
        `https://www.threads.com/@${username.replace(/^@/, '')}/post/${code}`,
    );
}

export function findCreatedThreadsPost(
    payload: unknown,
    text: string,
): CreatedThreadsPost | undefined {
    const expected = normalizedText(text);
    if (!expected) return undefined;

    const visit = (value: unknown): CreatedThreadsPost | undefined => {
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = visit(item);
                if (found) return found;
            }
            return undefined;
        }
        if (!isRecord(value)) return undefined;

        // Prefer the deepest matching media object. A mutation response can
        // also include the parent thread, so inspecting the root first risks
        // returning the parent's code for a newly-created reply.
        for (const item of Object.values(value)) {
            const found = visit(item);
            if (found) return found;
        }
        return candidateFromRecord(value, expected);
    };

    return visit(payload);
}
