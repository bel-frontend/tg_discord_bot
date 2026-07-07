// Encrypts/decrypts persisted browser session state (cookies + local storage).
// This is strictly more sensitive than the plaintext platformConfigs.values bag —
// a leaked session is a full account takeover, not a scoped API token — so unlike
// that path, this one is encrypted at rest with a server-held key.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedBlob } from './types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function loadKey(): Buffer {
    const raw = process.env.BROWSER_SESSION_ENC_KEY || '';
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LENGTH) {
        throw new Error(
            'BROWSER_SESSION_ENC_KEY must be a base64-encoded 32-byte key',
        );
    }
    return key;
}

/** Fails fast at boot if browser-session platforms are registered but the key is missing/invalid. */
export function assertBrowserSessionCryptoConfigured(): void {
    loadKey();
}

export function encryptSessionBlob(json: string): EncryptedBlob {
    const key = loadKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(json, 'utf8'),
        cipher.final(),
    ]);
    return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
    };
}

export function decryptSessionBlob(blob: EncryptedBlob): string {
    const key = loadKey();
    const decipher = createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(blob.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(blob.ciphertext, 'base64')),
        decipher.final(),
    ]);
    return plaintext.toString('utf8');
}
