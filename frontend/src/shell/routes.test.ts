import { describe, expect, it } from 'vitest';
import {
    editIdForPublishedOrDraft,
    editIdFromPath,
    pathForEdit,
    routeFromPath,
} from './routes';

describe('shell routes', () => {
    it('treats edit URLs as the composer route', () => {
        expect(routeFromPath('/edit/draft-1')).toBe('composer');
    });

    it('extracts and encodes draft ids for edit URLs', () => {
        expect(editIdFromPath('/edit/draft-1')).toBe('draft-1');
        expect(pathForEdit('draft 1')).toBe('/edit/draft%201');
    });

    it('uses publication ids for published archive edit URLs', () => {
        expect(editIdForPublishedOrDraft('draft-1', 'publication-1')).toBe(
            'publication-1',
        );
        expect(editIdForPublishedOrDraft('draft-1')).toBe('draft-1');
    });
});
