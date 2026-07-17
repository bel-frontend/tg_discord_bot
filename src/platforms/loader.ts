// Platform auto-discovery: every subdirectory of src/platforms/ that contains an
// index.ts exporting `createPlatform(): Platform` is loaded and registered at
// startup. Drop a new folder in — no core edits needed. See docs/platform-plugins.md.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Platform } from './types';
import { getPlatform, register } from './registry';

export interface LoadResult {
    loaded: string[]; // registered platform ids, in load order
    skipped: Array<{ dir: string; reason: string }>;
}

/** Runtime check that a value satisfies the Platform contract. */
export function isPlatform(value: unknown): value is Platform {
    if (typeof value !== 'object' || value === null) return false;
    const platform = value as Record<string, unknown>;
    return (
        typeof platform.id === 'string' &&
        platform.id.trim().length > 0 &&
        typeof platform.name === 'string' &&
        platform.name.trim().length > 0 &&
        typeof platform.isConfigured === 'function' &&
        typeof platform.listChannels === 'function' &&
        typeof platform.publish === 'function' &&
        typeof platform.toPreviewHtml === 'function'
    );
}

/**
 * Scan `dir` (default: this folder) for platform folders and register each one.
 * A broken folder is skipped with a warning so one bad plugin can't take the
 * server down; a duplicate platform id is a programmer error and throws.
 */
export async function loadPlatforms(
    dir = import.meta.dir,
): Promise<LoadResult> {
    const result: LoadResult = { loaded: [], skipped: [] };

    const entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    for (const name of entries) {
        const entryFile = join(dir, name, 'index.ts');
        if (!existsSync(entryFile)) {
            skip(result, name, 'no index.ts entry file');
            continue;
        }

        let module: Record<string, unknown>;
        try {
            module = await import(entryFile);
        } catch (error) {
            skip(result, name, `failed to import: ${message(error)}`);
            continue;
        }

        if (typeof module.createPlatform !== 'function') {
            skip(result, name, 'does not export createPlatform()');
            continue;
        }

        let platform: unknown;
        try {
            platform = module.createPlatform();
        } catch (error) {
            skip(result, name, `createPlatform() threw: ${message(error)}`);
            continue;
        }

        if (!isPlatform(platform)) {
            skip(result, name, 'createPlatform() did not return a valid Platform');
            continue;
        }

        if (getPlatform(platform.id)) {
            throw new Error(
                `Duplicate platform id "${platform.id}" (from src/platforms/${name})`,
            );
        }

        register(platform);
        result.loaded.push(platform.id);
    }

    return result;
}

function skip(result: LoadResult, dir: string, reason: string): void {
    console.warn(`Skipping platform folder "${dir}": ${reason}`);
    result.skipped.push({ dir, reason });
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
