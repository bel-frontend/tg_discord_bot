import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveMongoConfig } from './db';

const DB_PATH = join(import.meta.dir, 'db.ts');

describe('database runtime state', () => {
    test('is shared by separately evaluated module graphs', () => {
        const firstSpecifier = JSON.stringify(`${DB_PATH}?graph=first`);
        const secondSpecifier = JSON.stringify(`${DB_PATH}?graph=second`);
        const source = `
            const first = await import(${firstSpecifier});
            const sentinel = {};
            globalThis.__composerDbState.usersColl = sentinel;
            const second = await import(${secondSpecifier});
            if (first.users === second.users) throw new Error('modules were not separate');
            if (second.users() !== sentinel) throw new Error('DB state was not shared');
        `;
        const child = Bun.spawnSync(['bun', '--eval', source], {
            cwd: join(import.meta.dir, '..'),
            stdout: 'pipe',
            stderr: 'pipe',
        });

        expect(child.stderr.toString()).toBe('');
        expect(child.exitCode).toBe(0);
    });
});

describe('resolveMongoConfig', () => {
    test('builds the default remote composer MongoDB URI from env parts', () => {
        const config = resolveMongoConfig({
            MONGODB_PASSWORD: 'pa:ss@word',
        });

        expect(config).toEqual({
            uri: 'mongodb://admin:pa%3Ass%40word@10.8.0.34:27028/composer?authSource=admin&replicaSet=rs8',
            dbName: 'composer',
        });
    });

    test('keeps an explicit URI and uses its database name by default', () => {
        const config = resolveMongoConfig({
            MONGODB_URI:
                'mongodb://admin:secret@10.8.0.34:27028/custom?authSource=admin&replicaSet=rs8',
        });

        expect(config).toEqual({
            uri: 'mongodb://admin:secret@10.8.0.34:27028/custom?authSource=admin&replicaSet=rs8',
            dbName: 'custom',
        });
    });
});
