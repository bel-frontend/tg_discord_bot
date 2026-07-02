// Telegram owns its Markdown -> Telegram HTML conversion.
// Cross-platform editor extras supported here:
//   __underline__ -> <u>
//   ||spoiler||   -> <tg-spoiler>
import { marked } from 'marked';

function escapeHtml(s: string): string {
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function inlineWrapExtension(name: string, open: string, close: string) {
    const escOpen = open.replace(/[|]/g, '\\$&');
    const escClose = close.replace(/[|]/g, '\\$&');
    const rule = new RegExp(`^${escOpen}(?=\\S)([\\s\\S]*?\\S)${escClose}`);
    return {
        name,
        level: 'inline' as const,
        start(src: string) {
            return src.indexOf(open);
        },
        tokenizer(this: any, src: string) {
            const match = rule.exec(src);
            if (!match) return;
            return {
                type: name,
                raw: match[0],
                text: match[1],
                tokens: this.lexer.inlineTokens(match[1]),
            };
        },
        renderer() {
            return '';
        },
    };
}

marked.use({
    extensions: [
        inlineWrapExtension('underline', '__', '__'),
        inlineWrapExtension('spoiler', '||', '||'),
    ],
});

function renderInline(tokens: any[]): string {
    let out = '';
    for (const t of tokens) {
        switch (t.type) {
            case 'text':
                out += t.tokens ? renderInline(t.tokens) : escapeHtml(t.text);
                break;
            case 'escape':
                out += escapeHtml(t.text);
                break;
            case 'strong':
                out += `<b>${renderInline(t.tokens)}</b>`;
                break;
            case 'em':
                out += `<i>${renderInline(t.tokens)}</i>`;
                break;
            case 'del':
                out += `<s>${renderInline(t.tokens)}</s>`;
                break;
            case 'underline':
                out += `<u>${renderInline(t.tokens)}</u>`;
                break;
            case 'spoiler':
                out += `<tg-spoiler>${renderInline(t.tokens)}</tg-spoiler>`;
                break;
            case 'codespan':
                out += `<code>${escapeHtml(t.text)}</code>`;
                break;
            case 'br':
                out += '\n';
                break;
            case 'link':
                out += `<a href="${escapeHtml(t.href)}">${renderInline(
                    t.tokens,
                )}</a>`;
                break;
            case 'image':
                out += escapeHtml(t.text || t.title || t.href || '');
                break;
            case 'html':
                // Telegram rejects unknown tags, so escape raw HTML instead.
                out += escapeHtml(t.text);
                break;
            default:
                out += escapeHtml(t.raw ?? '');
        }
    }
    return out;
}

function renderList(list: any): string {
    let out = '';
    let index = Number(list.start) || 1;
    for (const item of list.items) {
        const marker = list.ordered ? `${index}. ` : '• ';
        out += `${marker}${renderBlocks(item.tokens).trim()}\n`;
        index++;
    }
    return out;
}

function renderBlocks(tokens: any[]): string {
    let out = '';
    for (const t of tokens) {
        switch (t.type) {
            case 'heading':
                out += `<b>${renderInline(t.tokens)}</b>\n\n`;
                break;
            case 'paragraph':
                out += `${renderInline(t.tokens)}\n\n`;
                break;
            case 'text':
                out += `${
                    t.tokens ? renderInline(t.tokens) : escapeHtml(t.text)
                }\n`;
                break;
            case 'code':
                out += `<pre>${escapeHtml(t.text)}</pre>\n\n`;
                break;
            case 'blockquote':
                out += `<blockquote>${renderBlocks(
                    t.tokens,
                ).trim()}</blockquote>\n\n`;
                break;
            case 'list':
                out += `${renderList(t)}\n`;
                break;
            case 'hr':
                out += '\n\n';
                break;
            case 'space':
                break;
            case 'html':
                out += escapeHtml(t.text);
                break;
            default:
                out += t.tokens
                    ? `${renderInline(t.tokens)}\n`
                    : escapeHtml(t.raw ?? '');
        }
    }
    return out;
}

export function markdownToTelegramHtml(markdown: string): string {
    const tokens = marked.lexer(markdown);
    return renderBlocks(tokens).replace(/\n{3,}/g, '\n\n').trim();
}
