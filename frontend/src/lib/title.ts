const MAX_LEN = 80;

function stripMarkdown(line: string): string {
    return line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_~`]/g, '')
        .trim();
}

/** Use the explicit title if given, otherwise derive one from the first non-empty line of markdown. */
export function deriveTitle(title: string, markdown: string): string {
    const trimmedTitle = title.trim();
    if (trimmedTitle) return trimmedTitle;

    const firstLine = markdown
        .split('\n')
        .map(stripMarkdown)
        .find((line) => line.length > 0);

    if (!firstLine) return 'Untitled';
    return firstLine.length > MAX_LEN
        ? `${firstLine.slice(0, MAX_LEN).trimEnd()}…`
        : firstLine;
}
