import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import {
    assertBrowserSessionCryptoConfigured,
    decryptSessionBlob,
    encryptSessionBlob,
} from './browserSessions/crypto';

process.env.BROWSER_SESSION_ENC_KEY = randomBytes(32).toString('base64');

describe('browser session crypto', () => {
    test('round-trips a storageState JSON blob', () => {
        const original = JSON.stringify({
            cookies: [{ name: 'sid', value: 'abc123' }],
            origins: [],
        });
        const blob = encryptSessionBlob(original);
        expect(decryptSessionBlob(blob)).toBe(original);
    });

    test('produces a different ciphertext/iv each time (random IV)', () => {
        const first = encryptSessionBlob('same input');
        const second = encryptSessionBlob('same input');
        expect(first.iv).not.toBe(second.iv);
        expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    test('rejects a tampered ciphertext', () => {
        const blob = encryptSessionBlob('sensitive session state');
        const tampered = {
            ...blob,
            ciphertext: Buffer.from('not the real ciphertext').toString(
                'base64',
            ),
        };
        expect(() => decryptSessionBlob(tampered)).toThrow();
    });

    test('rejects a tampered auth tag', () => {
        const blob = encryptSessionBlob('sensitive session state');
        const tampered = { ...blob, authTag: randomBytes(16).toString('base64') };
        expect(() => decryptSessionBlob(tampered)).toThrow();
    });

    test('assertBrowserSessionCryptoConfigured throws when the key is missing/invalid', () => {
        const original = process.env.BROWSER_SESSION_ENC_KEY;
        process.env.BROWSER_SESSION_ENC_KEY = 'too-short';
        expect(() => assertBrowserSessionCryptoConfigured()).toThrow();
        process.env.BROWSER_SESSION_ENC_KEY = original;
    });

    test('assertBrowserSessionCryptoConfigured passes with a valid key', () => {
        expect(() => assertBrowserSessionCryptoConfigured()).not.toThrow();
    });
});
