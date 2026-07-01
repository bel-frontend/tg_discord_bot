import { useEffect, useState } from 'react';
import { fetchPreview } from '../api';

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function renderDiscord(markdown: string): string {
    let html = escapeHtml(markdown);
    html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_m, code) => {
        return `<pre>${code.replace(/\n$/, '')}</pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler">$1</span>');
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
    html = html.replace(/\[([^\]]+)]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
    return html.replace(/\n/g, '<br/>');
}

interface Props {
    markdown: string;
}

export function PreviewPanel({ markdown }: Props) {
    const [tab, setTab] = useState<'telegram' | 'discord'>('telegram');
    const [preview, setPreview] = useState({ telegramHtml: '', discord: '' });

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (!markdown.trim()) {
                setPreview({ telegramHtml: '', discord: '' });
                return;
            }
            try {
                setPreview(await fetchPreview(markdown));
            } catch {
                // Preview is best-effort; publish/validation handle real errors.
            }
        }, 250);

        return () => clearTimeout(timer);
    }, [markdown]);

    const html =
        tab === 'telegram'
            ? preview.telegramHtml
            : renderDiscord(preview.discord);

    return (
        <div className="preview">
            <div className="preview-tabs">
                <button
                    className={`ptab ${tab === 'telegram' ? 'active' : ''}`}
                    onClick={() => setTab('telegram')}
                    type="button"
                >
                    ✈️ Telegram
                </button>
                <button
                    className={`ptab ${tab === 'discord' ? 'active' : ''}`}
                    onClick={() => setTab('discord')}
                    type="button"
                >
                    🎮 Discord
                </button>
            </div>
            <div className={`preview-bubble ${tab}`}>
                {html ? (
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                    <span className="muted">Nothing to preview yet.</span>
                )}
            </div>
        </div>
    );
}
