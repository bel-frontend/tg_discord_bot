import type { ChannelOption, PublishResult } from '../../../shared/types';
import { platformIcon } from './ChannelPicker';

interface Props {
    results: PublishResult[] | null;
    channels: ChannelOption[];
}

export function ResultsPanel({ results, channels }: Props) {
    if (!results) return null;

    function channelName(r: PublishResult): string {
        return (
            channels.find(
                (c) => c.platform === r.platform && c.id === r.channelId,
            )?.name || r.channelId
        );
    }

    return (
        <div className="results">
            <h4>Results</h4>
            {results.map((r, i) => (
                <div key={i} className={`result-row ${r.ok ? 'ok' : 'fail'}`}>
                    <span className="badge">{r.ok ? '✓' : '✗'}</span>
                    <span className="result-name">
                        {platformIcon(r.platform)} {channelName(r)}
                    </span>
                    {!r.ok && <span className="result-err">{r.error}</span>}
                </div>
            ))}
        </div>
    );
}
