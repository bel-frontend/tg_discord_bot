import { NodeHtmlMarkdown } from 'node-html-markdown';

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

// Discord renders Markdown natively, so publish mostly passes Markdown through.
export function markdownToDiscord(markdown: string): string {
    // Discord doesn't support Markdown horizontal rules; avoid leaking raw separators.
    return markdown.replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, '').trim();
}

export function markdownToDiscordPreviewHtml(markdown: string): string {
    let html = escapeHtml(markdownToDiscord(markdown));
    html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_m, code) => {
        return `<pre>${code.replace(/\n$/, '')}</pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(
        /\|\|([\s\S]+?)\|\|/g,
        '<span class="spoiler">$1</span>',
    );
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    html = html.replace(/__([^_]+)__/g, '<u>$1</u>');
    html = html.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^[-*] (.*)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.*)$/gm, '<li>$1</li>');
    html = html.replace(
        /\[([^\]]+)]\((https?:[^)]+)\)/g,
        '<a href="$2">$1</a>',
    );
    return html.replace(/\n/g, '<br/>');
}

// Legacy helper: convert HTML input to Discord Markdown (kept for inbound bot paths).
export function htmlToDiscordMarkdown(html: string): string {
    // These options are valid at runtime but incomplete in shipped type defs.
    const nhm = new NodeHtmlMarkdown({
        strongDelimiter: '**',
        emDelimiter: '*',
        codeBlockStyle: 'fenced',
        bulletMarker: '•',
        headingStyle: 'atx',
        hr: '---',
        br: '\n',
        keepDataImages: false,
        useLinkReferenceDefinitions: false,
        useInlineLinks: true,
        blockElements: [
            'p',
            'div',
            'blockquote',
            'pre',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'ul',
            'ol',
            'li',
            'table',
            'thead',
            'tbody',
            'tr',
            'th',
            'td',
        ],
    } as any);
    function cleanUpMarkdown(md: string): string {
        return md
            .replace(/•(?=\S)/g, '• ')
            .replace(/\*\*(.+?)\*\*(?=\S)/g, '**$1**\n')
            .trim();
    }
    const cleanedHtml = html.replaceAll(/\n/g, '<br/>');
    return cleanUpMarkdown(nhm.translate(cleanedHtml));
}
