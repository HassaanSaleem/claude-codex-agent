import { describe, it, expect } from 'vitest';
import { sanitizeStreamingMarkdown } from '../../src/utils/streamSanitizer.js';

describe('sanitizeStreamingMarkdown', () => {
  it('passes complete markdown through unchanged', () => {
    const md = '# Hello\n\n```ts\nconst x = 1;\n```\n\nDone.';
    expect(sanitizeStreamingMarkdown(md)).toBe(md);
  });

  it('closes an unclosed code fence', () => {
    const md = 'Here is code:\n\n```ts\nconst x = 1;';
    const result = sanitizeStreamingMarkdown(md);
    expect(result).toBe('Here is code:\n\n```ts\nconst x = 1;\n```');
  });

  it('handles multiple code blocks with one unclosed', () => {
    const md = '```js\nfoo();\n```\n\nMore text\n\n```py\nbar()';
    const result = sanitizeStreamingMarkdown(md);
    expect(result).toBe('```js\nfoo();\n```\n\nMore text\n\n```py\nbar()\n```');
  });

  it('does not add extra fence when all blocks are closed', () => {
    const md = '```\nblock1\n```\n\n```\nblock2\n```';
    expect(sanitizeStreamingMarkdown(md)).toBe(md);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeStreamingMarkdown('')).toBe('');
  });

  it('passes text with no code fences through unchanged', () => {
    const md = 'Just some **bold** and *italic* text.';
    expect(sanitizeStreamingMarkdown(md)).toBe(md);
  });

  it('handles unclosed fence ending with newline', () => {
    const md = '```\ncode here\n';
    const result = sanitizeStreamingMarkdown(md);
    expect(result).toBe('```\ncode here\n```');
  });
});
