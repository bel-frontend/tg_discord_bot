// Size-limit chunking, extracted from fileReader.ts so it can be reused without a bot instance.

export interface ParsedContent {
    text: string;
    isFormatted: boolean;
}

export interface ChunkedText {
    telegramChunks: string[];
    discordChunks: string[];
}

export const TELEGRAM_LIMIT = 4096;
export const DISCORD_LIMIT = 2000;

export function chunkText(content: ParsedContent): ChunkedText {
    return {
        telegramChunks: splitTextIntoChunks(
            content.text,
            TELEGRAM_LIMIT,
            content.isFormatted,
        ),
        discordChunks: splitTextIntoChunks(
            content.text,
            DISCORD_LIMIT,
            content.isFormatted,
        ),
    };
}

export function splitTextIntoChunks(
    text: string,
    maxLength: number,
    preserveFormatting: boolean,
): string[] {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks: string[] = [];
    let currentChunk = '';

    // Split by paragraphs first if we have formatting
    const paragraphs = preserveFormatting
        ? text.split('\n\n')
        : text.split('\n');

    for (const paragraph of paragraphs) {
        const paragraphWithSeparator =
            paragraph + (preserveFormatting ? '\n\n' : '\n');

        if (paragraphWithSeparator.length > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk.trimEnd());
                currentChunk = '';
            }

            const subChunks = splitLongParagraph(
                paragraph,
                maxLength,
                preserveFormatting,
            );
            chunks.push(...subChunks);
            continue;
        }

        if (currentChunk.length + paragraphWithSeparator.length > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk.trimEnd());
                currentChunk = '';
            }
        }

        currentChunk += paragraphWithSeparator;
    }

    if (currentChunk) {
        chunks.push(currentChunk.trimEnd());
    }

    return chunks.filter((chunk) => chunk.length > 0);
}

function splitLongParagraph(
    paragraph: string,
    maxLength: number,
    preserveFormatting: boolean,
): string[] {
    const chunks: string[] = [];

    if (preserveFormatting) {
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        let currentChunk = '';

        for (const sentence of sentences) {
            const sentenceWithSpace = (currentChunk ? ' ' : '') + sentence;

            if (currentChunk.length + sentenceWithSpace.length > maxLength) {
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = sentence;
                } else {
                    const wordChunks = splitLineByWords(sentence, maxLength);
                    chunks.push(...wordChunks);
                }
            } else {
                currentChunk += sentenceWithSpace;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk);
        }
    } else {
        const wordChunks = splitLineByWords(paragraph, maxLength);
        chunks.push(...wordChunks);
    }

    return chunks;
}

function splitLineByWords(line: string, maxLength: number): string[] {
    const words = line.split(' ');
    const chunks: string[] = [];
    let currentChunk = '';

    for (const word of words) {
        const wordWithSpace = (currentChunk ? ' ' : '') + word;

        if (currentChunk.length + wordWithSpace.length > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = word;
            } else {
                chunks.push(word.substring(0, maxLength));
                currentChunk = word.substring(maxLength);
            }
        } else {
            currentChunk += wordWithSpace;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}
