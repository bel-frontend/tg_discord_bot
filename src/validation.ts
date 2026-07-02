import { markdownToDiscord, markdownToTelegramHtml } from './converters/markdown';
import { splitTextIntoChunks, TELEGRAM_LIMIT } from './chunk';
import { validateTelegramHtml } from './telegramValidation';

export interface ValidationIssue {
    platform: string;
    chunk: number;
    message: string;
    tag?: string;
    offset?: number;
    line?: number;
    excerpt?: string;
    htmlContext?: string;
}

function lineInfo(markdown: string, index: number) {
    const before = markdown.slice(0, Math.max(0, index));
    const line = before.split('\n').length;
    const lineStart = markdown.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
    const nextNewline = markdown.indexOf('\n', index);
    const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
    return {
        line,
        excerpt: markdown.slice(lineStart, lineEnd).trim(),
    };
}

function findLikelyMarkdownSource(markdown: string, tag?: string) {
    const checks: Array<[RegExp, string[]]> = [
        [/^>\s?.+/m, ['blockquote']],
        [/```[\s\S]*?```/, ['pre']],
        [/`[^`\n]+`/, ['code']],
        [/\|\|[\s\S]+?\|\|/, ['tg-spoiler']],
        [/__[\s\S]+?__/, ['u', 'ins']],
        [/\*\*[\s\S]+?\*\*/, ['b', 'strong']],
        [/~~[\s\S]+?~~/, ['s', 'strike', 'del']],
        [/\*[^*\n]+?\*/, ['i', 'em']],
        [/\[[^\]]+]\([^)]+\)/, ['a']],
    ];

    for (const [pattern, tags] of checks) {
        if (tag && !tags.includes(tag)) continue;
        const match = pattern.exec(markdown);
        if (match?.index !== undefined) return lineInfo(markdown, match.index);
    }

    return undefined;
}

function htmlContext(chunk: string, offset?: number) {
    if (offset === undefined) return undefined;
    const start = Math.max(0, offset - 80);
    const end = Math.min(chunk.length, offset + 140);
    return chunk.slice(start, end);
}

export function validateMarkdown(markdown: string): {
    ok: boolean;
    issues: ValidationIssue[];
} {
    const telegramHtml = markdownToTelegramHtml(markdown);
    const chunks = splitTextIntoChunks(telegramHtml, TELEGRAM_LIMIT, true);
    const issues = chunks.flatMap((chunk, index) =>
        validateTelegramHtml(chunk).map((issue) => {
            const source = findLikelyMarkdownSource(markdown, issue.tag);
            return {
                platform: 'telegram',
                chunk: index + 1,
                ...issue,
                line: source?.line,
                excerpt: source?.excerpt,
                htmlContext: htmlContext(chunk, issue.offset),
            };
        }),
    );

    return { ok: issues.length === 0, issues };
}

export function previewContent(markdown: string): {
    telegramHtml: string;
    discord: string;
} {
    return {
        telegramHtml: markdownToTelegramHtml(markdown),
        discord: markdownToDiscord(markdown),
    };
}
