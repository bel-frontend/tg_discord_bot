import { describe, expect, test } from 'bun:test';
import { resolveMongoConfig } from './db';

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
