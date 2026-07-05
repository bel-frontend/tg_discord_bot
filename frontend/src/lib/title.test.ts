import { describe, expect, it } from 'vitest';
import { deriveTitle } from './title';

describe('deriveTitle', () => {
    it('keeps an explicit title as-is', () => {
        expect(deriveTitle('  My Post  ', 'body text')).toBe('My Post');
    });

    it('falls back to Untitled when both title and markdown are blank', () => {
        expect(deriveTitle('', '   \n  ')).toBe('Untitled');
    });

    it('derives from the first non-empty line of markdown', () => {
        expect(deriveTitle('', '\n\nHello world\nmore text')).toBe('Hello world');
    });

    it('strips heading, list, and emphasis markdown syntax', () => {
        expect(deriveTitle('', '## **Big** announcement')).toBe('Big announcement');
        expect(deriveTitle('', '- [ ] Buy milk')).toBe('Buy milk');
        expect(deriveTitle('', '1. First step')).toBe('First step');
        expect(deriveTitle('', '> A quote')).toBe('A quote');
    });

    it('converts links and images to their text/alt', () => {
        expect(deriveTitle('', '[Click here](https://example.com)')).toBe('Click here');
        expect(deriveTitle('', '![alt text](https://example.com/x.png)')).toBe('alt text');
    });

    it('truncates long first lines with an ellipsis', () => {
        const long = 'a'.repeat(120);
        const result = deriveTitle('', long);
        expect(result).toBe(`${'a'.repeat(80)}…`);
    });
});
