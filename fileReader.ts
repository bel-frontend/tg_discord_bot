import TelegramBot from "node-telegram-bot-api";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// We'll use pdf2pic and then OCR, or try pdf-lib for better formatting extraction
let pdfParse: any;
let pdfLib: any;

try {
  pdfParse = require('pdf-parse');
  pdfLib = require('pdf-lib');
} catch (error) {
  console.warn('PDF parsing libraries not installed. Install pdf-parse and pdf-lib for better PDF support.');
}

interface ChunkedText {
  telegramChunks: string[];
  discordChunks: string[];
}

interface ParsedContent {
  text: string;
  isFormatted: boolean;
}

interface PDFTextItem {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
  hasEOL: boolean;
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
        return await this.extractFromPDFAdvanced(uint8Array);
      } else if (fileName.toLowerCase().endsWith('.txt')) {
        return { text: this.extractFromTXT(uint8Array), isFormatted: false };
      } else {
        throw new Error('Unsupported file format. Only .txt and .pdf files are supported.');
      }
    } catch (error) {
      throw new Error(`File processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractFromPDFAdvanced(buffer: Uint8Array): Promise<ParsedContent> {
    try {
      // Try advanced parsing with pdf-parse render_page option to get text items
      const options = {
        pagerender: (pageData: any) => {
          return this.renderPageWithFormatting(pageData);
        }
      };

      const data = await pdfParse(buffer, options);
      
      // If we got formatted text from our custom renderer, use it
      if (data.formattedText) {
        return {
          text: data.formattedText,
          isFormatted: true
        };
      }

      // Fallback to basic text with enhancement
      const enhancedText = this.enhancePDFFormatting(data.text);
      
      return {
        text: enhancedText,
        isFormatted: true
      };
    } catch (error) {
      console.error('Advanced PDF parsing failed:', error);
      
      // Fallback to basic pdf-parse
      try {
        const data = await pdfParse(buffer);
        const enhancedText = this.enhancePDFFormatting(data.text);
        
        return {
          text: enhancedText,
          isFormatted: true
        };
      } catch (fallbackError) {
        throw new Error('Failed to extract text from PDF. The file might be corrupted or password-protected.');
      }
    }
  }

  private async renderPageWithFormatting(pageData: any): Promise<string> {
    try {
      // Get text content with positioning and font information
      const textContent = await pageData.getTextContent();
      const items: PDFTextItem[] = textContent.items;
      
      if (!items || items.length === 0) {
        return '';
      }

      // Group text items by their vertical position (Y coordinate)
      const lines: { [key: number]: PDFTextItem[] } = {};
      
      items.forEach((item: PDFTextItem) => {
        const y = Math.round(item.transform[5]); // Y position
        if (!lines[y]) {
          lines[y] = [];
        }
        lines[y].push(item);
      });

      // Sort lines by Y position (top to bottom)
      const sortedY = Object.keys(lines).map(Number).sort((a, b) => b - a);
      
      const formattedLines: string[] = [];
      let previousFontSize = 0;
      let previousY = 0;

      for (const y of sortedY) {
        const lineItems = lines[y].sort((a, b) => a.transform[4] - b.transform[4]); // Sort by X position
        
        let lineText = '';
        let lineFormatting = '';
        let maxFontSize = 0;
        
        for (const item of lineItems) {
          const fontSize = item.transform[0]; // Font size from transform matrix
          const fontName = item.fontName || '';
          const text = item.str;
          
          maxFontSize = Math.max(maxFontSize, fontSize);
          
          // Detect formatting based on font properties
          let formattedText = text;
          
          // Bold detection (common bold font names or larger size)
          if (fontName.toLowerCase().includes('bold') || 
              fontName.toLowerCase().includes('black') ||
              fontSize > previousFontSize * 1.2) {
            formattedText = `<b>${text}</b>`;
          }
          
          // Italic detection
          else if (fontName.toLowerCase().includes('italic') || 
                   fontName.toLowerCase().includes('oblique')) {
            formattedText = `<i>${text}</i>`;
          }
          
          lineText += formattedText;
        }
        
        // Detect headers (larger font size or significant gap)
        const yGap = previousY - y;
        if (maxFontSize > previousFontSize * 1.3 || yGap > maxFontSize * 2) {
          if (lineText.trim() && lineText.length < 100) {
            lineText = `<b>${lineText.trim()}</b>`;
          }
        }
        
        // Add extra line break for large gaps (paragraph separation)
        if (yGap > maxFontSize * 1.5 && formattedLines.length > 0) {
          formattedLines.push('');
        }
        
        if (lineText.trim()) {
          formattedLines.push(lineText.trim());
        }
        
        previousFontSize = maxFontSize;
        previousY = y;
      }
      
      return formattedLines.join('\n');
    } catch (error) {
      console.error('Error in renderPageWithFormatting:', error);
      return '';
    }
  }

  private enhancePDFFormatting(rawText: string): string {
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

      // Enhanced header detection
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
      
      // Detect quoted text
      else if (this.isQuotedText(line)) {
        line = `<i>"${line.replace(/^["'"'\s]*/, '').replace(/["'"'\s]*$/, '')}"</i>`;
      }

      // Detect emphasis patterns and preserve them
      line = this.detectAndPreserveEmphasis(line);

      processedLines.push(line);
    }

    // Join lines back and clean up
    text = processedLines.join('\n');
    text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines

    return text;
  }

  private isLikelyHeader(line: string, allLines: string[], index: number): boolean {
    const nextLine = allLines[index + 1]?.trim() || '';
    const prevLine = allLines[index - 1]?.trim() || '';
    
    // Check multiple criteria for header detection
    const criteria = [
      // Short lines followed by content
      line.length < 60 && nextLine.length > line.length,
      
      // Lines with high uppercase ratio
      (line.match(/[A-ZА-Я]/g) || []).length / line.length > 0.6 && line.length > 3,
      
      // Lines ending with colon
      line.endsWith(':') && line.length < 80,
      
      // Chapter/section patterns
      /^(Chapter|Section|Part|Глава|Раздел|ГЛАВА|РАЗДЕЛ)\s+\d+/i.test(line),
      
      // Roman numerals
      /^[IVX]+\.\s+/.test(line),
      
      // All caps short lines
      line === line.toUpperCase() && line.length < 50 && line.length > 3,
      
      // Lines surrounded by empty lines and short
      prevLine === '' && nextLine === '' && line.length < 60
    ];
    
    return criteria.some(criterion => criterion);
  }

  private isListItem(line: string): boolean {
    return /^[\-\*\•▪▫]\s+/.test(line);
  }

  private isNumberedListItem(line: string): boolean {
    return /^\d+[\.\)]\s+/.test(line) || /^[a-zA-Z][\.\)]\s+/.test(line);
  }

  private isQuotedText(line: string): boolean {
    return /^["'"']/.test(line) || 
           /^\s{4,}/.test(line) || 
           line.startsWith('»') || 
           line.startsWith('«');
  }

  private detectAndPreserveEmphasis(line: string): string {
    // Detect and preserve various emphasis patterns
    return line
      // ALL CAPS words (but not entire sentences or common abbreviations)
      .replace(/\b[A-ZА-Я]{3,}\b/g, (match) => {
        if (match.length < 15 && 
            line !== match && 
            !/^(USD|EUR|PDF|HTML|XML|JSON|API|URL|HTTP|HTTPS|CEO|CTO|FAQ|USA|UK|EU|NATO|USSR|USA)$/.test(match)) {
          return `<b>${match}</b>`;
        }
        return match;
      })
      // Words surrounded by asterisks
      .replace(/\*([^*]+)\*/g, '<b>$1</b>')
      // Words surrounded by underscores
      .replace(/\b_([^_]+)_\b/g, '<i>$1</i>')
      // Words in quotes that might be emphasized
      .replace(/"([^"]{1,50})"/g, '<i>"$1"</i>');
  }

  private extractFromTXT(buffer: Uint8Array): string {
    try {
      // Try UTF-8 first
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(buffer);
    } catch (error) {
      // Fallback to Windows-1251 for Cyrillic
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
      
      if (paragraphWithSeparator.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trimEnd());
          currentChunk = '';
        }
        
        const subChunks = this.splitLongParagraph(paragraph, maxLength, preserveFormatting);
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

    return chunks.filter(chunk => chunk.length > 0);
  }

  private splitLongParagraph(paragraph: string, maxLength: number, preserveFormatting: boolean): string[] {
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
