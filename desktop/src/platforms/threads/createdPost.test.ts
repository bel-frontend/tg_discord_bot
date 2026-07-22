import { describe, expect, test } from 'bun:test';
import { findCreatedThreadsPost } from './createdPost';

describe('findCreatedThreadsPost', () => {
    test('extracts the created post from a Threads mutation response', () => {
        expect(
            findCreatedThreadsPost(
                {
                    data: {
                        create_text_post: {
                            media: {
                                code: 'ABC123',
                                caption: { text: 'The post we published' },
                                user: { username: 'composer' },
                            },
                        },
                    },
                },
                'The post we published',
            ),
        ).toEqual({
            messageId: 'ABC123',
            link: 'https://www.threads.com/@composer/post/ABC123',
        });
    });

    test('prefers the matching reply over an unrelated parent post', () => {
        expect(
            findCreatedThreadsPost(
                {
                    data: {
                        parent: {
                            code: 'PARENT',
                            caption: { text: 'Parent post' },
                            user: { username: 'someone' },
                        },
                        reply: {
                            permalink:
                                'https://www.threads.com/@composer/post/REPLY',
                            caption: { text: 'Our exact reply' },
                        },
                    },
                },
                'Our exact reply',
            ),
        ).toEqual({
            messageId: 'REPLY',
            link: 'https://www.threads.com/@composer/post/REPLY',
        });
    });

    test('ignores feed responses that do not contain the published text', () => {
        expect(
            findCreatedThreadsPost(
                {
                    code: 'WRONG',
                    caption: { text: 'Unrelated feed post' },
                    user: { username: 'other' },
                },
                'Our post',
            ),
        ).toBeUndefined();
    });
});
