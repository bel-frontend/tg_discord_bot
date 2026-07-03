import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduledQueue } from './ScheduledQueue';

const loadScheduledPublications = vi.fn(async () => undefined);
const cancelScheduledPublication = vi.fn(async () => undefined);

vi.mock('../toast', () => ({
    useToast: () => vi.fn(),
}));

vi.mock('../hooks/useScheduledPublications', () => ({
    useScheduledPublications: () => ({
        scheduledPublications: [],
        publicationArchive: [
            {
                id: 'publication-1',
                draftId: 'draft-1',
                title: 'Published post',
                markdown: 'body',
                imageUrls: [],
                targets: [
                    {
                        platform: 'telegram',
                        channelId: 'channel-1',
                        messageIds: ['message-1'],
                        ok: true,
                        updatedAt: '2026-07-03T09:00:00.000Z',
                    },
                ],
                createdAt: '2026-07-03T09:00:00.000Z',
                updatedAt: '2026-07-03T09:00:00.000Z',
            },
        ],
        loadScheduledPublications,
        cancelScheduledPublication,
    }),
}));

describe('ScheduledQueue', () => {
    it('opens archive rows with both draft id and publication id', async () => {
        const onOpenDraft = vi.fn();

        render(<ScheduledQueue onOpenDraft={onOpenDraft} />);

        fireEvent.click(screen.getByRole('button', { name: /archive/i }));
        fireEvent.click(screen.getByText('Published post'));

        await waitFor(() => {
            expect(onOpenDraft).toHaveBeenCalledWith(
                'draft-1',
                'publication-1',
            );
        });
    });
});
