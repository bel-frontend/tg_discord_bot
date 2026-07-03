import { describe, expect, it } from 'vitest';
import { draftIdFromPath, pathForDraft, routeFromPath } from './routes';

describe('shell routes', () => {
    it('treats edit URLs as the composer route', () => {
        expect(routeFromPath('/edit/draft-1')).toBe('composer');
    });

    it('extracts and encodes draft ids for edit URLs', () => {
        expect(draftIdFromPath('/edit/draft-1')).toBe('draft-1');
        expect(pathForDraft('draft 1')).toBe('/edit/draft%201');
    });
});
