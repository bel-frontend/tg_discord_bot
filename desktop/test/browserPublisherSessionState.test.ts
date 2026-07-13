import { describe, expect, test } from 'bun:test';
import {
    hasMatchingSessionCookie,
    isConnectedPageUrl,
} from '../src/browserPublisherSessionState';

describe('browser publisher connection state', () => {
    test('does not treat the Instagram login flow as connected Threads', () => {
        const cookies = [
            {
                name: 'sessionid',
                value: 'instagram-session',
                domain: '.instagram.com',
            },
        ];

        expect(
            hasMatchingSessionCookie(
                cookies,
                ['sessionid'],
                ['threads.com', 'threads.net', 'instagram.com'],
            ),
        ).toBe(true);
        expect(
            isConnectedPageUrl(
                'https://www.instagram.com/accounts/login/',
                'https://www.threads.com/',
                'https://www.threads.com/login',
            ),
        ).toBe(false);
        expect(
            isConnectedPageUrl(
                'https://www.threads.com/login',
                'https://www.threads.com/',
                'https://www.threads.com/login',
            ),
        ).toBe(false);
    });

    test('accepts the platform home page after the login flow returns', () => {
        expect(
            isConnectedPageUrl(
                'https://www.threads.com/',
                'https://www.threads.com/',
                'https://www.threads.com/login',
            ),
        ).toBe(true);
    });
});
