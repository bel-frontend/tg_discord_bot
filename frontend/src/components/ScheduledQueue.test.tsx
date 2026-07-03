import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduledQueue } from './ScheduledQueue';
import { MeProvider } from '../meContext';
import type { Me } from '../../../shared/types';

const ownerMe: Me = {
    user: { id: 'owner-1', email: 'owner@example.com' },
    accountId: 'owner-1',
    role: 'owner',
    permissions: {
        channelAccess: 'all',
        canPublish: true,
        canDelete: true,
        canManageChannels: true,
        canManageMembers: true,
    },
    emailVerified: true,
};

function renderWithOwner(ui: React.ReactElement) {
    return render(<MeProvider me={ownerMe}>{ui}</MeProvider>);
}

const loadScheduledPublications = vi.fn(async () => undefined);
const cancelScheduledPublication = vi.fn(async () => undefined);
const deleteArchivePublication = vi.fn(async () => ({
    results: [{ ok: true }],
    deleted: true,
}));

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
        deleteArchivePublication,
    }),
}));

describe('ScheduledQueue', () => {
    it('opens archive rows with both draft id and publication id', async () => {
        const onOpenDraft = vi.fn();

        renderWithOwner(<ScheduledQueue onOpenDraft={onOpenDraft} />);

        fireEvent.click(screen.getByRole('button', { name: /archive/i }));
        fireEvent.click(screen.getByText('Published post'));

        await waitFor(() => {
            expect(onOpenDraft).toHaveBeenCalledWith(
                'draft-1',
                'publication-1',
            );
        });
    });

    it('deletes archive rows without opening the editor', async () => {
        const onOpenDraft = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
        deleteArchivePublication.mockClear();

        renderWithOwner(<ScheduledQueue onOpenDraft={onOpenDraft} />);

        fireEvent.click(screen.getByRole('button', { name: /archive/i }));
        fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[1]);

        await waitFor(() => {
            expect(deleteArchivePublication).toHaveBeenCalledWith(
                'publication-1',
            );
        });
        expect(onOpenDraft).not.toHaveBeenCalled();
    });
});
