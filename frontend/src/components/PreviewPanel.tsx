import { useEffect, useState } from 'react';
import { fetchPreview } from '../api';
import type { PlatformMeta } from '../../../shared/types';

interface Props {
    markdown: string;
    platforms: PlatformMeta[];
}

export function PreviewPanel({ markdown, platforms }: Props) {
    const [tab, setTab] = useState('');
    const [preview, setPreview] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!tab && platforms.length) setTab(platforms[0].id);
    }, [platforms, tab]);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (!markdown.trim()) {
                setPreview({});
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

    const html = preview[tab] ?? '';

    return (
        <div className="preview">
            <div className="preview-tabs">
                {platforms.map((p) => (
                    <button
                        key={p.id}
                        className={`ptab ${tab === p.id ? 'active' : ''}`}
                        onClick={() => setTab(p.id)}
                        type="button"
                    >
                        {p.icon ?? '🌐'} {p.name}
                    </button>
                ))}
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
