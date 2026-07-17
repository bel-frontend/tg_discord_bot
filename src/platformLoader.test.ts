import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPlatform, loadPlatforms } from './platforms/loader';
import { getPlatform } from './platforms/registry';

const LOADER_PATH = join(import.meta.dir, 'platforms', 'loader.ts');

const VALID_PLATFORM_SOURCE = (id: string) => `
export function createPlatform() {
    return {
        id: '${id}',
        name: 'Fixture ${id}',
        isConfigured: () => false,
        listChannels: async () => [],
        publish: async () => [],
        toPreviewHtml: (markdown) => markdown,
    };
}
`;

function makeFixtureDir(): string {
    return mkdtempSync(join(tmpdir(), 'platform-loader-'));
}

const fixtureDirs: string[] = [];

afterAll(() => {
    for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
});

describe('isPlatform', () => {
    const valid = {
        id: 'p',
        name: 'P',
        isConfigured: () => true,
        listChannels: async () => [],
        publish: async () => [],
        toPreviewHtml: (markdown: string) => markdown,
    };

    test('accepts a minimal valid platform', () => {
        expect(isPlatform(valid)).toBe(true);
    });

    test('rejects missing or empty id/name', () => {
        expect(isPlatform({ ...valid, id: undefined })).toBe(false);
        expect(isPlatform({ ...valid, id: '  ' })).toBe(false);
        expect(isPlatform({ ...valid, name: '' })).toBe(false);
    });

    test('rejects missing required methods', () => {
        expect(isPlatform({ ...valid, publish: undefined })).toBe(false);
        expect(isPlatform({ ...valid, listChannels: 'nope' })).toBe(false);
        expect(isPlatform(null)).toBe(false);
        expect(isPlatform('platform')).toBe(false);
    });
});

describe('loadPlatforms', () => {
    test('discovers every platform folder in src/platforms', () => {
        // Run in a separate process: several test files replace core modules
        // with partial mock.module('./db', ...) mocks process-wide, which would
        // poison a real-tree import performed inside this test run.
        const proc = Bun.spawnSync(
            [
                'bun',
                '-e',
                `const { loadPlatforms } = await import(${JSON.stringify(LOADER_PATH)});` +
                    'console.log(JSON.stringify(await loadPlatforms()));',
            ],
            { cwd: join(import.meta.dir, '..') },
        );
        expect(proc.exitCode).toBe(0);
        const result = JSON.parse(proc.stdout.toString().trim());
        expect(result.loaded).toEqual(
            expect.arrayContaining(['bluesky', 'discord', 'telegram', 'threads', 'x']),
        );
        // Alphabetical folder order keeps registration deterministic.
        expect(result.loaded).toEqual([...result.loaded].sort());
        expect(result.skipped).toEqual([]);
    });

    test('skips invalid folders without failing and loads the valid ones', async () => {
        const dir = makeFixtureDir();
        fixtureDirs.push(dir);
        mkdirSync(join(dir, 'no-entry'));
        mkdirSync(join(dir, 'no-factory'));
        writeFileSync(join(dir, 'no-factory', 'index.ts'), 'export const x = 1;\n');
        mkdirSync(join(dir, 'bad-shape'));
        writeFileSync(
            join(dir, 'bad-shape', 'index.ts'),
            'export function createPlatform() { return { id: "bad" }; }\n',
        );
        mkdirSync(join(dir, 'good'));
        writeFileSync(
            join(dir, 'good', 'index.ts'),
            VALID_PLATFORM_SOURCE('fixture-good'),
        );

        const result = await loadPlatforms(dir);
        expect(result.loaded).toEqual(['fixture-good']);
        expect(result.skipped.map((entry) => entry.dir).sort()).toEqual([
            'bad-shape',
            'no-entry',
            'no-factory',
        ]);
        expect(getPlatform('fixture-good')).toBeDefined();
    });

    test('throws on a duplicate platform id', async () => {
        const dir = makeFixtureDir();
        fixtureDirs.push(dir);
        mkdirSync(join(dir, 'first'));
        writeFileSync(
            join(dir, 'first', 'index.ts'),
            VALID_PLATFORM_SOURCE('fixture-dup'),
        );
        mkdirSync(join(dir, 'second'));
        writeFileSync(
            join(dir, 'second', 'index.ts'),
            VALID_PLATFORM_SOURCE('fixture-dup'),
        );

        await expect(loadPlatforms(dir)).rejects.toThrow(
            'Duplicate platform id',
        );
    });
});
