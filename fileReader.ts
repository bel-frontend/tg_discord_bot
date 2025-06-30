import TelegramBot from "node-telegram-bot-api";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

interface ChunkedText {
  telegramChunks: string[];
  discordChunks: string[];
}

interface ParsedContent {
  text: string;
  isFormatted: boolean;
}

export class FileReader {
  private bot: TelegramBot;

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  async extractTextFromFile(fileId: string, fileName: string): Promise<ParsedContent> {
    try {
      const file = await this.bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      if (fileName.toLowerCase().endsWith('.pdf')) {
        return await this.extractFromPDF(uint8Array);
      } else if (fileName.toLowerCase().endsWith('.txt')) {
        return { text: this.extractFromTXT(uint8Array), isFormatted: false };
      } else {
        throw new Error('Unsupported file format. Only .txt and .pdf files are supported.');
      }
    } catch (error) {
      throw new Error(`File processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractFromPDF(buffer: Uint8Array): Promise<ParsedContent> {
    try {
      const data = await pdfParse(buffer, {
        // Get more detailed parsing options
        max: 0, // No limit on pages
        version: 'v1.10.100'
      });

      // Try to preserve formatting by analyzing text patterns
      const formattedText = this.enhancePDFFormatting(data.text, data);
      
      return {
        text: formattedText,
        isFormatted: true
      };
    } catch (error) {
      throw new Error('Failed to extract text from PDF. The file might be corrupted or password-protected.');
    }
  }

  private enhancePDFFormatting(rawText: string, pdfData: any): string {
    let text = rawText;

    // Split into lines for processing
    const lines = text.split('\n');
    const processedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      if (!line) {
        processedLines.push('');
        continue;
      }

      // Detect headers (lines that are short, capitalized, or followed by empty lines)
      if (this.isLikelyHeader(line, lines, i)) {
        line = `<b>${line}</b>`;
      }
      
      // Detect bullet points and lists
      else if (this.isListItem(line)) {
        line = `• ${line.replace(/^[\-\*\•]\s*/, '')}`;
      }
      
      // Detect numbered lists
      else if (this.isNumberedListItem(line)) {
        // Keep as is, already formatted
      }
      
      // Detect quoted text (lines starting with quotes or indented)
      else if (this.isQuotedText(line)) {
        line = `<i>"${line.replace(/^["'"'\s]*/, '').replace(/["'"'\s]*$/, '')}"</i>`;
      }

      // Detect emphasis patterns (words in ALL CAPS that aren't entire sentences)
      line = this.detectEmphasis(line);

      processedLines.push(line);
    }

    // Join lines back and clean up multiple empty lines
    text = processedLines.join('\n');
    text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines

    return text;
  }

  private isLikelyHeader(line: string, allLines: string[], index: number): boolean {
    // Check if line is likely a header based on various criteria
    const nextLine = allLines[index + 1]?.trim() || '';
    const prevLine = allLines[index - 1]?.trim() || '';
    
    // Short lines (< 50 chars) that are followed by empty line or content
    if (line.length < 50 && (nextLine === '' || nextLine.length > line.length)) {
      return true;
    }
    
    // Lines that are mostly uppercase (excluding common words)
    const upperRatio = (line.match(/[A-Z]/g) || []).length / line.length;
    if (upperRatio > 0.7 && line.length > 3) {
      return true;
    }
    
    // Lines ending with colon
    if (line.endsWith(':') && line.length < 80) {
      return true;
    }
    
    // Chapter/section patterns
    if (/^(Chapter|Section|Part|Глава|Раздел)\s+\d+/i.test(line)) {
      return true;
    }
    
    return false;
  }

  private isListItem(line: string): boolean {
    return /^[\-\*\•]\s+/.test(line);
  }

  private isNumberedListItem(line: string): boolean {
    return /^\d+[\.\)]\s+/.test(line);
  }

  private isQuotedText(line: string): boolean {
    // Lines starting with quotes or heavily indented
    return /^["'"']/.test(line) || /^\s{4,}/.test(line);
  }

  private detectEmphasis(line: string): string {
    // Detect words in ALL CAPS (but not entire sentences)
    return line.replace(/\b[A-ZА-Я]{2,}\b/g, (match) => {
      // Don't format if it's a common abbreviation or the entire line is caps
      if (match.length < 15 && line !== match && !/^(USD|EUR|PDF|HTML|XML|JSON|API|URL|HTTP|HTTPS|CEO|CTO|FAQ|USA|UK|EU)$/.test(match)) {
        return `<b>${match}</b>`;
      }
      return match;
    });
  }

  private extractFromTXT(buffer: Uint8Array): string {
    try {
      // Try UTF-8 first, fallback to other encodings if needed
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(buffer);
    } catch (error) {
      // Fallback to Windows-1251 for Cyrillic text
      try {
        const decoder = new TextDecoder('windows-1251');
        return decoder.decode(buffer);
      } catch (fallbackError) {
        throw new Error('Failed to decode text file. Unsupported encoding.');
      }
    }
  }

  chunkText(content: ParsedContent): ChunkedText {
    const telegramLimit = 4096;
    const discordLimit = 2000;

    return {
      telegramChunks: this.splitTextIntoChunks(content.text, telegramLimit, content.isFormatted),
      discordChunks: this.splitTextIntoChunks(content.text, discordLimit, content.isFormatted)
    };
  }

  private splitTextIntoChunks(text: string, maxLength: number, preserveFormatting: boolean): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let currentChunk = '';
    
    // Split by paragraphs first if we have formatting
    const paragraphs = preserveFormatting ? text.split('\n\n') : text.split('\n');
    
    for (const paragraph of paragraphs) {
      const paragraphWithSeparator = paragraph + (preserveFormatting ? '\n\n' : '\n');
      
      // If a single paragraph is longer than the limit, split it
      if (paragraphWithSeparator.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trimEnd());
          currentChunk = '';
        }
        
        // Split long paragraph by sentences or lines
        const subChunks = this.splitLongParagraph(paragraph, maxLength, preserveFormatting);
        chunks.push(...subChunks);
        continue;
      }

      // If adding this paragraph would exceed the limit, save current chunk
      if (currentChunk.length + paragraphWithSeparator.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trimEnd());
          currentChunk = '';
        }
      }

      currentChunk += paragraphWithSeparator;
    }

    // Add the last chunk if it exists
    if (currentChunk) {
      chunks.push(currentChunk.trimEnd());
    }

    return chunks.filter(chunk => chunk.length > 0);
  }

  private splitLongParagraph(paragraph: string, maxLength: number, preserveFormatting: boolean): string[] {
    const chunks: string[] = [];
    
    if (preserveFormatting) {
      // Try to split by sentences first
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let currentChunk = '';
      
      for (const sentence of sentences) {
        const sentenceWithSpace = (currentChunk ? ' ' : '') + sentence;
        
        if (currentChunk.length + sentenceWithSpace.length > maxLength) {
          if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = sentence;
          } else {
            // Single sentence is too long, split by words
            const wordChunks = this.splitLineByWords(sentence, maxLength);
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
      // Fallback to word splitting
      const wordChunks = this.splitLineByWords(paragraph, maxLength);
      chunks.push(...wordChunks);
    }
    
    return chunks;
  }

  private splitLineByWords(line: string, maxLength: number): string[] {
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
          // Single word is too long, force split
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
}
