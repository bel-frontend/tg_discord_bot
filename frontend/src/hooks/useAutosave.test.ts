import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

describe('useAutosave', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces scheduleSave to 1000ms by default', () => {
        const saveDraft = vi.fn().mockResolvedValue(undefined);
        const setSaveStatus = vi.fn();
        const collect = vi.fn(() => ({ title: 'My post', markdown: 'hi' }));
        const { result } = renderHook(() =>
            useAutosave(collect, saveDraft, setSaveStatus),
        );

        act(() => {
            result.current.scheduleSave();
        });
        expect(setSaveStatus).toHaveBeenCalledWith('Saving…');
        expect(saveDraft).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(999);
        });
        expect(saveDraft).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(saveDraft).toHaveBeenCalledWith(true);
    });

    it('re-scheduling within the debounce window resets the timer', () => {
        const saveDraft = vi.fn().mockResolvedValue(undefined);
        const setSaveStatus = vi.fn();
        const collect = vi.fn(() => ({ title: 'My post', markdown: 'hi' }));
        const { result } = renderHook(() =>
            useAutosave(collect, saveDraft, setSaveStatus),
        );

        act(() => {
            result.current.scheduleSave();
        });
        act(() => {
            vi.advanceTimersByTime(600);
        });
        act(() => {
            result.current.scheduleSave();
        });
        act(() => {
            vi.advanceTimersByTime(600);
        });
        expect(saveDraft).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(400);
        });
        expect(saveDraft).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there is no content worth saving', () => {
        const saveDraft = vi.fn();
        const setSaveStatus = vi.fn();
        const collect = vi.fn(() => ({ title: 'Untitled', markdown: '   ' }));
        const { result } = renderHook(() =>
            useAutosave(collect, saveDraft, setSaveStatus),
        );

        act(() => {
            result.current.scheduleSave();
        });
        expect(setSaveStatus).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(saveDraft).not.toHaveBeenCalled();
    });

    it('withSuppressed blocks scheduleSave during the callback, then releases ~50ms later', () => {
        const saveDraft = vi.fn();
        const setSaveStatus = vi.fn();
        const collect = vi.fn(() => ({ title: 'My post', markdown: 'hi' }));
        const { result } = renderHook(() =>
            useAutosave(collect, saveDraft, setSaveStatus),
        );

        act(() => {
            result.current.withSuppressed(() => {
                result.current.scheduleSave();
            });
        });
        expect(setSaveStatus).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(49);
        });
        act(() => {
            result.current.scheduleSave();
        });
        expect(setSaveStatus).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        act(() => {
            result.current.scheduleSave();
        });
        expect(setSaveStatus).toHaveBeenCalledWith('Saving…');
    });
});
