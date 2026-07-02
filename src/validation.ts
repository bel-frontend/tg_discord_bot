import type { Platform, ValidationIssue } from './platforms/types';

export type { ValidationIssue };

export function validateMarkdown(
    markdown: string,
    platforms: Platform[],
): {
    ok: boolean;
    issues: ValidationIssue[];
} {
    const issues = platforms.flatMap(
        (platform) => platform.validateContent?.(markdown) ?? [],
    );
    return { ok: issues.length === 0, issues };
}

export function previewContent(
    markdown: string,
    platforms: Platform[],
): Record<string, string> {
    return Object.fromEntries(
        platforms.map((platform) => [
            platform.id,
            platform.toPreviewHtml(markdown),
        ]),
    );
}
