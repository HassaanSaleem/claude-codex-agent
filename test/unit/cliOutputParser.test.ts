import { describe, it, expect } from 'vitest';
import {
  parseClaudeStreamLine,
  parseCodexStreamLine,
  extractFinalText,
  detectQuestions,
  extractInlineClarifications,
} from '../../src/utils/cliOutputParser.js';

describe('parseClaudeStreamLine', () => {
  it('parses assistant message with text content', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello world');
    expect(result!.isResult).toBe(false);
    expect(result!.source).toBe('assistant');
  });

  it('parses result message', () => {
    const line = JSON.stringify({ type: 'result', result: 'Final answer' });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Final answer');
    expect(result!.isResult).toBe(true);
    expect(result!.source).toBe('result');
  });

  it('parses content_block_delta', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { text: 'chunk' },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('chunk');
    expect(result!.source).toBe('delta');
  });

  it('parses thinking_delta as source=thinking', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'Let me consider...' },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Let me consider...');
    expect(result!.isResult).toBe(false);
    expect(result!.source).toBe('thinking');
  });

  it('still parses regular content_block_delta after thinking support', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { text: 'regular chunk' },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('regular chunk');
    expect(result!.source).toBe('delta');
  });

  it('returns null for thinking_delta with empty thinking text', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: '' },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).toBeNull();
  });

  it('still parses result events correctly after thinking support', () => {
    const line = JSON.stringify({ type: 'result', result: 'Final answer' });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.isResult).toBe(true);
    expect(result!.source).toBe('result');
  });

  it('returns null for empty lines', () => {
    expect(parseClaudeStreamLine('')).toBeNull();
    expect(parseClaudeStreamLine('  ')).toBeNull();
  });

  it('treats non-JSON as plain text', () => {
    const result = parseClaudeStreamLine('plain text output');
    expect(result).not.toBeNull();
    expect(result!.text).toBe('plain text output');
    expect(result!.source).toBe('plain');
  });

  // CLI 2.1.x stream_event wrapper support
  it('unwraps stream_event wrapper for content_block_delta', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('hello');
    expect(result!.source).toBe('delta');
  });

  it('unwraps stream_event wrapper for thinking_delta', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('hmm');
    expect(result!.source).toBe('thinking');
  });

  it('returns null for stream_event with unhandled inner event', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_stop' },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).toBeNull();
  });
});

describe('parseCodexStreamLine', () => {
  it('parses message events', () => {
    const line = JSON.stringify({ type: 'message', content: 'Review complete' });
    const result = parseCodexStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Review complete');
  });

  it('parses item.completed events with text', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: 'Hello from Codex' },
    });
    const result = parseCodexStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello from Codex');
    expect(result!.source).toBe('assistant');
  });

  it('parses item.completed events with content array', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { type: 'message', content: [{ type: 'output_text', text: 'Nested text' }] },
    });
    const result = parseCodexStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Nested text');
  });

  it('parses completion events as final', () => {
    const line = JSON.stringify({ type: 'completion', text: 'Done' });
    const result = parseCodexStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Done');
    expect(result!.isResult).toBe(true);
  });

  it('extracts text field as fallback', () => {
    const line = JSON.stringify({ type: 'unknown', text: 'Some output' });
    const result = parseCodexStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Some output');
  });

  it('returns null for empty lines', () => {
    expect(parseCodexStreamLine('')).toBeNull();
  });
});

describe('detectQuestions', () => {
  it('detects AskUserQuestion tool_use from Claude JSONL', () => {
    const line = JSON.stringify({
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        name: 'AskUserQuestion',
        input: { question: 'Should I use REST or GraphQL?' },
      },
    });
    const result = detectQuestions(line, 'claude');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('claude');
    expect(result!.detectedVia).toBe('tool_use');
    expect(result!.questionText).toBe('Should I use REST or GraphQL?');
    expect(result!.answer).toBeNull();
  });

  it('returns null for regular Claude text output', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { text: 'Here is my plan...' },
    });
    expect(detectQuestions(line, 'claude')).toBeNull();
  });

  it('detects heuristic question from Codex text', () => {
    const line = JSON.stringify({
      type: 'message',
      content: 'Should I use TypeScript or JavaScript for this project?',
    });
    const result = detectQuestions(line, 'codex');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('codex');
    expect(result!.detectedVia).toBe('heuristic');
    expect(result!.questionText).toContain('Should I use TypeScript or JavaScript');
  });

  it('returns null for Codex text with no question', () => {
    const line = JSON.stringify({
      type: 'message',
      content: 'The implementation looks correct.',
    });
    expect(detectQuestions(line, 'codex')).toBeNull();
  });

  it('returns null for Codex text without question patterns', () => {
    // Ending with ? but no trigger words (Should I, Would you, QUESTION, etc.)
    const line = 'The build passed all checks?';
    expect(detectQuestions(line, 'codex')).toBeNull();
  });

  it('generates unique id and correct source field', () => {
    const line = JSON.stringify({
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        name: 'AskUserQuestion',
        input: { question: 'First question?' },
      },
    });
    const result1 = detectQuestions(line, 'claude');
    const result2 = detectQuestions(line, 'claude');
    expect(result1!.id).toBeTruthy();
    expect(result2!.id).toBeTruthy();
    expect(result1!.id).not.toBe(result2!.id);
    expect(result1!.source).toBe('claude');
  });

  it('returns null for empty lines', () => {
    expect(detectQuestions('', 'claude')).toBeNull();
    expect(detectQuestions('  ', 'codex')).toBeNull();
  });
});

describe('extractInlineClarifications', () => {
  it('extracts questions from clarification_questions tags', () => {
    const text = `Here is some context.

<clarification_questions>
[{"question":"What should I focus on?","options":[{"label":"Feature A","description":"Build feature A"},{"label":"Feature B","description":"Build feature B"}]}]
</clarification_questions>

Let me know your choice.`;

    const { questions, cleanedText } = extractInlineClarifications(text);
    expect(questions).toHaveLength(1);
    expect(questions[0].questionText).toBe('What should I focus on?');
    expect(questions[0].options).toHaveLength(2);
    expect(questions[0].options![0].label).toBe('Feature A');
    expect(questions[0].source).toBe('claude');
    expect(questions[0].detectedVia).toBe('heuristic');
    expect(cleanedText).toContain('Here is some context.');
    expect(cleanedText).toContain('Let me know your choice.');
    expect(cleanedText).not.toContain('clarification_questions');
  });

  it('returns empty questions and original text when no tags present', () => {
    const text = 'Normal response with no questions.';
    const { questions, cleanedText } = extractInlineClarifications(text);
    expect(questions).toHaveLength(0);
    expect(cleanedText).toBe(text);
  });

  it('handles multiple questions in one block', () => {
    const text = `<clarification_questions>
[{"question":"Q1?","options":[{"label":"A","description":"a"}]},{"question":"Q2?","options":[{"label":"B","description":"b"}]}]
</clarification_questions>`;

    const { questions } = extractInlineClarifications(text);
    expect(questions).toHaveLength(2);
    expect(questions[0].questionText).toBe('Q1?');
    expect(questions[1].questionText).toBe('Q2?');
  });

  it('handles questions without options', () => {
    const text = `<clarification_questions>
[{"question":"What is your preference?"}]
</clarification_questions>`;

    const { questions } = extractInlineClarifications(text);
    expect(questions).toHaveLength(1);
    expect(questions[0].questionText).toBe('What is your preference?');
    expect(questions[0].options).toBeUndefined();
  });

  it('skips blocks with invalid JSON', () => {
    const text = `<clarification_questions>
not valid json
</clarification_questions>`;

    const { questions, cleanedText } = extractInlineClarifications(text);
    expect(questions).toHaveLength(0);
    expect(cleanedText).toBe('');
  });
});

describe('Token usage extraction (007-token-cost-tracking)', () => {
  it('extracts usage from Claude result event', () => {
    const line = JSON.stringify({
      type: 'result',
      result: 'Final answer',
      usage: { input_tokens: 1500, output_tokens: 300 },
    });
    const result = parseClaudeStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.usage).toBeDefined();
    expect(result!.usage!.inputTokens).toBe(1500);
    expect(result!.usage!.outputTokens).toBe(300);
  });

  it('extracts cache tokens from Claude result event', () => {
    const line = JSON.stringify({
      type: 'result',
      result: 'Cached answer',
      usage: {
        input_tokens: 2000,
        output_tokens: 400,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 200,
      },
    });
    const result = parseClaudeStreamLine(line);
    expect(result!.usage!.cacheReadTokens).toBe(500);
    expect(result!.usage!.cacheWriteTokens).toBe(200);
  });

  it('returns undefined usage when no usage field in result', () => {
    const line = JSON.stringify({ type: 'result', result: 'No usage' });
    const result = parseClaudeStreamLine(line);
    expect(result!.usage).toBeUndefined();
  });

  it('returns undefined usage when usage has zero tokens', () => {
    const line = JSON.stringify({
      type: 'result',
      result: 'Zero',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const result = parseClaudeStreamLine(line);
    expect(result!.usage).toBeUndefined();
  });

  it('extracts usage from Codex response.completed event', () => {
    const line = JSON.stringify({
      type: 'response.completed',
      response: {
        output: [{ type: 'message', text: 'Done' }],
        usage: { input_tokens: 800, output_tokens: 150 },
      },
    });
    const result = parseCodexStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.usage).toBeDefined();
    expect(result!.usage!.inputTokens).toBe(800);
    expect(result!.usage!.outputTokens).toBe(150);
  });
});

describe('extractFinalText', () => {
  it('concatenates all parsed chunks', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Part 1 ' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Part 2' }] } }),
    ];
    const text = extractFinalText(lines, parseClaudeStreamLine);
    expect(text).toBe('Part 1 Part 2');
  });

  it('returns empty string for no parseable lines', () => {
    const text = extractFinalText(['', '  '], parseClaudeStreamLine);
    expect(text).toBe('');
  });
});
