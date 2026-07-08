import { marked } from 'marked';

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

function stripResidualMarkdown(value: string): string {
    return value
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
        .replace(/(\*\*|__)(\s*)([\s\S]*?)(\s*)\1/g, '$2$3$4')
        .replace(/(\*|_)(\s*)([^\n*_][\s\S]*?)(\s*)\1/g, '$2$3$4')
        .replace(/~~(\s*)([\s\S]*?)(\s*)~~/g, '$1$2$3')
        .replace(/`([^`]+)`/g, '$1');
}

export function markdownToThreadsText(markdown: string): string {
    return stripResidualMarkdown(
        marked
            .lexer(markdown)
            .map(tokenText)
            .join('\n\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n'),
    )
        .trim();
}

export function markdownToThreadsPreviewHtml(markdown: string): string {
    return escapeHtml(markdownToThreadsText(markdown)).replace(/\n/g, '<br/>');
}
