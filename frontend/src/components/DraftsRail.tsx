import type { Draft } from '../../../shared/types';

interface Props {
    drafts: Draft[];
    activeId: string | null;
    onNew: () => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
}

export function DraftsRail({
    drafts,
    activeId,
    onNew,
    onOpen,
    onDelete,
}: Props) {
    return (
        <aside className="rail">
            <div className="rail-head">
                <span>Drafts</span>
                <button className="btn small" onClick={onNew}>
                    ＋ New
                </button>
            </div>
            <ul className="drafts-list">
                {drafts.length === 0 && (
                    <li className="drafts-empty">No drafts yet</li>
                )}
                {drafts.map((draft) => (
                    <li
                        key={draft.id}
                        className={`draft-item ${
                            draft.id === activeId ? 'active' : ''
                        }`}
                    >
                        <button
                            className="draft-open"
                            onClick={() => onOpen(draft.id)}
                        >
                            <span className="draft-title">{draft.title}</span>
                            <span className="draft-time">
                                {new Date(draft.updatedAt).toLocaleString()}
                            </span>
                        </button>
                        <button
                            className="draft-del"
                            title="Delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(draft.id);
                            }}
                        >
                            ✕
                        </button>
                    </li>
                ))}
            </ul>
        </aside>
    );
}
