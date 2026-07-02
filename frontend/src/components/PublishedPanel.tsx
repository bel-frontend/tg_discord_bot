import type { Publication } from '../../../shared/types';

interface Props {
    publications: Publication[];
    publishing: boolean;
    onUpdate: (publication: Publication) => void;
    onDelete: (publication: Publication) => void;
}

export function PublishedPanel({
    publications,
    publishing,
    onUpdate,
    onDelete,
}: Props) {
    if (!publications.length) return null;

    return (
        <div className="published-panel">
            <h4>Published</h4>
            {publications.map((publication) => {
                const okTargets = publication.targets.filter(
                    (target) => target.ok,
                ).length;
                return (
                    <div className="published-item" key={publication.id}>
                        <div>
                            <strong>
                                {new Date(
                                    publication.updatedAt,
                                ).toLocaleString()}
                            </strong>
                            <span>
                                {okTargets}/{publication.targets.length}{' '}
                                channels
                            </span>
                        </div>
                        <div className="published-actions">
                            <button
                                className="btn small"
                                disabled={publishing}
                                onClick={() => onUpdate(publication)}
                            >
                                Update
                            </button>
                            <button
                                className="btn small danger"
                                disabled={publishing}
                                onClick={() => onDelete(publication)}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
