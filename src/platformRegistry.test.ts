import { describe, expect, test } from 'bun:test';
import {
    deleteTargets,
    listPlatformsMeta,
    publishToTargets,
    register,
    updateTargets,
} from './platforms/registry';
import type {
    Channel,
    Platform,
    PublishContent,
    PublishedMessageRef,
    PublishResult,
} from './platforms/types';

class LinkableTestPlatform implements Platform {
    readonly id = 'unit-platform';
    readonly name = 'Unit Platform';
    readonly icon = 'U';
    readonly charLimit = 123;

    isConfigured(): boolean {
        return true;
    }

    async listChannels(): Promise<Channel[]> {
        return [];
    }

    toPreviewHtml(markdown: string): string {
        return markdown;
    }

    buildMessageLink(channelId: string, messageId: string): string {
        return `https://example.test/${channelId}/${messageId}`;
    }

    async publish(
        channelIds: string[],
        _content: PublishContent,
    ): Promise<PublishResult[]> {
        return channelIds.map((channelId) => ({
            platform: this.id,
            channelId,
            ok: true,
            messageIds: ['msg-1'],
        }));
    }

    async update(
        refs: PublishedMessageRef[],
        _content: PublishContent,
    ): Promise<PublishResult[]> {
        return refs.map((ref) => ({
            platform: this.id,
            channelId: ref.channelId,
            ok: true,
            messageIds: ref.messageIds,
        }));
    }
}

register(new LinkableTestPlatform());

describe('platform registry metadata', () => {
    test('exposes platform metadata without platform-specific branching', () => {
        expect(listPlatformsMeta()).toContainEqual({
            id: 'unit-platform',
            name: 'Unit Platform',
            icon: 'U',
            charLimit: 123,
        });
    });
});

describe('publishToTargets', () => {
    test('attaches adapter-built message links to successful results', async () => {
        const results = await publishToTargets(
            [{ platform: 'unit-platform', channelId: 'chan-1' }],
            { markdown: 'hello' },
        );

        expect(results).toEqual([
            {
                platform: 'unit-platform',
                channelId: 'chan-1',
                ok: true,
                messageIds: ['msg-1'],
                link: 'https://example.test/chan-1/msg-1',
            },
        ]);
    });
});

describe('platform operations without adapter support', () => {
    test('returns stable errors for unsupported update/delete operations', async () => {
        const refs = [
            {
                platform: 'unit-platform',
                channelId: 'chan-1',
                messageIds: ['msg-1'],
            },
        ];

        const updates = await updateTargets(refs, { markdown: 'new' });
        expect(updates[0]).toEqual({
            platform: 'unit-platform',
            channelId: 'chan-1',
            ok: true,
            messageIds: ['msg-1'],
            link: 'https://example.test/chan-1/msg-1',
        });

        const deletes = await deleteTargets(refs);
        expect(deletes).toEqual([
            {
                platform: 'unit-platform',
                channelId: 'chan-1',
                ok: false,
                messageIds: ['msg-1'],
                error: 'Unit Platform does not support deletes yet',
            },
        ]);
    });
});
