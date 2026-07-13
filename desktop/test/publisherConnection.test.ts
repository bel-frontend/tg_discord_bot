import { expect, test } from 'bun:test';
import { applyPublisherConnectionChange } from '../src/publisherConnection';

test('reports the platform before returning its updated status', async () => {
    const calls: string[] = [];
    const status = await applyPublisherConnectionChange(
        async () => {
            calls.push('change');
        },
        async () => {
            calls.push('heartbeat');
        },
        async () => {
            calls.push('status');
            return { connected: true };
        },
    );

    expect(calls).toEqual(['change', 'heartbeat', 'status']);
    expect(status).toEqual({ connected: true });
});
