// Resolves the name<->id channel list for each platform, from .env first and then
// channels.json. Entries can be a bare id/username or "id|Friendly name".
import { readFileSync } from 'fs';
import type { Channel } from './platforms/types';

interface ChannelsConfig {
    [platformId: string]: Channel[];
}

// Which env var holds the comma-separated channel list for each platform.
const ENV_VAR_BY_PLATFORM: Record<string, string | undefined> = {
    telegram: 'TELEGRAM_CHANNEL_USERNAMES',
    discord: 'DISCORD_CHANNEL_IDS',
};

let cache: ChannelsConfig | null = null;

function loadConfig(): ChannelsConfig {
    if (cache) return cache;

    const path = process.env.CHANNELS_CONFIG_PATH || './channels.json';
    try {
        const text = readFileSync(path, 'utf-8');
        cache = JSON.parse(text) as ChannelsConfig;
    } catch {
        cache = {};
    }
    return cache;
}

/** Parse "a, b|Label, c" into channels, tolerating inline `# comments`. */
function parseEnvList(value: string): Channel[] {
    return value
        .split(',')
        .map((entry) => entry.replace(/\s+#.*$/, '').trim()) // strip trailing comment
        .filter(Boolean)
        .map((entry) => {
            const [id, name] = entry.split('|').map((p) => p.trim());
            return { id, name: name || id };
        });
}

function getEnvChannels(platformId: string): Channel[] {
    const varName = ENV_VAR_BY_PLATFORM[platformId];
    const raw = varName ? process.env[varName] : undefined;
    return raw ? parseEnvList(raw) : [];
}

/**
 * Configured channels for a platform: env list merged with channels.json
 * (deduped by id, env taking precedence).
 */
export function getConfiguredChannels(platformId: string): Channel[] {
    const fromEnv = getEnvChannels(platformId);
    const fromFile = loadConfig()[platformId] ?? [];

    const merged = [...fromEnv];
    const seen = new Set(fromEnv.map((c) => c.id));
    for (const c of fromFile) {
        if (!seen.has(c.id)) merged.push(c);
    }
    return merged;
}
