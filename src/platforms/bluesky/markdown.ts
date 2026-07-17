import { marked } from 'marked';

// Bluesky posts are plain text (rich features arrive as facets, not markup), so
// markdown is flattened to text — same flattening approach as x/markdown.ts, kept
// local per the "a platform module must not depend on another platform module's
// internals" rule. Links become "text URL" so facet detection makes them clickable.

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function tokenText(token: any): string {
    switch (token.type) {
        case 'space':
            return '\n';
        case 'heading':
            return inlineText(token.tokens ?? [token]);
        case 'paragraph':
            return inlineText(token.tokens ?? [token]);
        case 'blockquote':
            return token.tokens.map(tokenText).join('\n');
        case 'list':
            return token.items
                .map((item: any, index: number) => {
                    const marker = token.ordered ? `${index + 1}. ` : '- ';
                    return marker + item.tokens.map(tokenText).join('\n').trim();
                })
                .join('\n');
        case 'code':
            return token.text;
        case 'hr':
            return '';
        case 'html':
            return token.text ?? '';
        default:
            return token.text ?? token.raw ?? '';
    }
}

function inlineText(tokens: any[]): string {
    return tokens
        .map((token) => {
            switch (token.type) {
                case 'link':
                    return token.href && token.href !== token.text
                        ? `${inlineText(token.tokens ?? [token])} ${token.href}`
                        : inlineText(token.tokens ?? [token]);
                case 'image':
                    return token.href ?? '';
                case 'br':
                    return '\n';
                case 'codespan':
                    return token.text;
                case 'strong':
                case 'em':
                case 'del':
                    return inlineText(token.tokens ?? [token]);
                default:
                    return token.text ?? token.raw ?? '';
            }
        })
        .join('');
}

export function markdownToBlueskyText(markdown: string): string {
    return marked
        .lexer(markdown)
        .map(tokenText)
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function markdownToBlueskyPreviewHtml(markdown: string): string {
    return escapeHtml(markdownToBlueskyText(markdown)).replace(/\n/g, '<br/>');
}
