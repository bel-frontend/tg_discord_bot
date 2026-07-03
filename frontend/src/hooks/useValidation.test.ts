import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../api', () => ({
    validatePost: vi.fn(),
}));

import { validatePost } from '../api';
import { useValidation } from './useValidation';

const TELEGRAM_TARGETS = [{ platform: 'telegram', channelId: 'chan1' }];

describe('useValidation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(validatePost).mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not call validatePost for empty/whitespace markdown', async () => {
        const { result } = renderHook(
            ({ markdown }) => useValidation(markdown, TELEGRAM_TARGETS),
            { initialProps: { markdown: '   ' } },
        );

        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });

        expect(validatePost).not.toHaveBeenCalled();
        expect(result.current.validationIssues).toEqual([]);
    });

    it('does not call validatePost when no target platforms are selected', async () => {
        const { result } = renderHook(
            ({ markdown }) => useValidation(markdown, []),
            { initialProps: { markdown: 'hello' } },
        );

        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });

        expect(validatePost).not.toHaveBeenCalled();
        expect(result.current.validationIssues).toEqual([]);
    });

    it('calls validatePost 350ms after a markdown change, scoped to the selected target platforms', async () => {
        vi.mocked(validatePost).mockResolvedValue({
            ok: false,
            issues: [{ platform: 'telegram', chunk: 1, message: 'bad' }],
        });

        const { result, rerender } = renderHook(
            ({ markdown }) => useValidation(markdown, TELEGRAM_TARGETS),
            { initialProps: { markdown: '' } },
        );
        rerender({ markdown: 'hello' });

        expect(validatePost).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(350);
        });

        expect(validatePost).toHaveBeenCalledWith('hello', ['telegram']);
        expect(result.current.validationIssues).toEqual([
            { platform: 'telegram', chunk: 1, message: 'bad' },
        ]);
    });

    it('re-validates when the target platform selection changes', async () => {
        vi.mocked(validatePost).mockResolvedValue({ ok: true, issues: [] });

        const { rerender } = renderHook(
            ({ targets }) => useValidation('hello', targets),
            { initialProps: { targets: TELEGRAM_TARGETS } },
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(350);
        });
        expect(validatePost).toHaveBeenCalledWith('hello', ['telegram']);

        rerender({
            targets: [
                { platform: 'telegram', channelId: 'chan1' },
                { platform: 'discord', channelId: 'chan2' },
            ],
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(350);
        });

        expect(validatePost).toHaveBeenCalledWith('hello', [
            'discord',
            'telegram',
        ]);
    });

    it('cancels the previous debounce when markdown changes again quickly', async () => {
        vi.mocked(validatePost).mockResolvedValue({ ok: true, issues: [] });

        const { rerender } = renderHook(
            ({ markdown }) => useValidation(markdown, TELEGRAM_TARGETS),
            { initialProps: { markdown: '' } },
        );
        rerender({ markdown: 'first' });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        rerender({ markdown: 'second' });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });

        expect(validatePost).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(150);
        });

        expect(validatePost).toHaveBeenCalledTimes(1);
        expect(validatePost).toHaveBeenCalledWith('second', ['telegram']);
    });

    it('silently ignores validatePost failures (advisory only)', async () => {
        vi.mocked(validatePost).mockRejectedValue(new Error('network'));

        const { result, rerender } = renderHook(
            ({ markdown }) => useValidation(markdown, TELEGRAM_TARGETS),
            { initialProps: { markdown: '' } },
        );
        rerender({ markdown: 'hello' });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(350);
        });

        expect(result.current.validationIssues).toEqual([]);
    });
});
