const TELEGRAM_TAGS = new Set([
    'b',
    'strong',
    'i',
    'em',
    'u',
    'ins',
    's',
    'strike',
    'del',
    'a',
    'code',
    'pre',
    'blockquote',
    'tg-spoiler',
]);

export interface TelegramValidationIssue {
    message: string;
    tag?: string;
    offset?: number;
}

export function validateTelegramHtml(html: string): TelegramValidationIssue[] {
    const issues: TelegramValidationIssue[] = [];
    const stack: Array<{ tag: string; offset: number }> = [];
    const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s+[^<>]*?)?>/g;
    let match: RegExpExecArray | null;

    while ((match = tagRe.exec(html))) {
        const raw = match[0];
        const tag = match[1].toLowerCase();

        if (!TELEGRAM_TAGS.has(tag)) {
            issues.push({
                message: `Unsupported Telegram HTML tag <${tag}>`,
                tag,
                offset: match.index,
            });
            continue;
        }

        if (raw.startsWith('</')) {
            const top = stack.pop();
            if (!top) {
                issues.push({
                    message: `Closing tag </${tag}> has no matching opening tag`,
                    tag,
                    offset: match.index,
                });
                continue;
            }
            if (top.tag !== tag) {
                issues.push({
                    message: `Closing tag </${tag}> does not match opening tag <${top.tag}>`,
                    tag,
                    offset: match.index,
                });
            }
        } else {
            stack.push({ tag, offset: match.index });
        }
    }

    for (const item of stack.reverse()) {
        issues.push({
            message: `Opening tag <${item.tag}> is not closed`,
            tag: item.tag,
            offset: item.offset,
        });
    }

    return issues;
}

export function isValidTelegramHtml(html: string): boolean {
    return validateTelegramHtml(html).length === 0;
}
