import { describe, expect, test } from 'bun:test';
import {
    buildClickThreadsDeleteMenuItemScript,
    buildClickThreadsMoreScript,
    buildConfirmThreadsDeleteScript,
} from './deleteScript';

describe('Threads delete renderer scripts', () => {
    test('produce valid renderer JavaScript', () => {
        const scripts = [
            buildClickThreadsMoreScript(
                'https://www.threads.com/@composer/post/ABC123',
            ),
            buildClickThreadsDeleteMenuItemScript(),
            buildConfirmThreadsDeleteScript(),
        ];

        for (const script of scripts) {
            expect(() => new Function(script)).not.toThrow();
        }
    });
});
