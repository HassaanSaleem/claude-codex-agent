/**
 * Parse streaming JSONL output from Claude Code CLI and Codex CLI.
 *
 * Claude Code (--output-format stream-json) emits lines like:
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"type":"content_block_delta","delta":{"text":"..."}}
 *   {"type":"result","result":"final text",...}
 *
 * Codex (--json) emits structured event lines like:
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"type":"message","content":"..."}
 *   {"type":"completion","text":"..."}
 */

export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ParsedChunk {
  text: string;
  isResult: boolean;
  /** 'assistant' for full messages, 'delta' for streaming deltas, 'result' for final, 'thinking' for thinking blocks */
  source: 'assistant' | 'delta' | 'result' | 'plain' | 'thinking';
  raw: unknown;
  /** Token usage from result events (007-token-cost-tracking) */
  usage?: ParsedUsage;
}

export function parseClaudeStreamLine(line: string): ParsedChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    let parsed = JSON.parse(trimmed);

    // CLI 2.1.x wraps streaming events in {"type":"stream_event","event":{...}}
    if (parsed.type === 'stream_event' && parsed.event) {
      parsed = parsed.event;
    }

    // Result message (final output)
    if (parsed.type === 'result') {
      const resultText = typeof parsed.result === 'string'
        ? parsed.result
        : JSON.stringify(parsed.result);
      // Extract token usage if present
      const usage = extractUsageFromParsed(parsed);
      return { text: resultText, isResult: true, source: 'result', raw: parsed, usage };
    }

    // Assistant message with content blocks (full message at end of turn)
    if (parsed.type === 'assistant' && parsed.message?.content) {
      const textParts = parsed.message.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text);
      if (textParts.length > 0) {
        return { text: textParts.join(''), isResult: false, source: 'assistant', raw: parsed };
      }
    }

    // Thinking block delta (extended thinking / chain-of-thought)
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
      return { text: parsed.delta.thinking, isResult: false, source: 'thinking', raw: parsed };
    }

    // Content block delta (streaming incremental text)
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
      return { text: parsed.delta.text, isResult: false, source: 'delta', raw: parsed };
    }

    return null;
  } catch {
    // Not JSON — treat as plain text output
    return { text: trimmed, isResult: false, source: 'plain', raw: trimmed };
  }
}

export function parseCodexStreamLine(line: string): ParsedChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);

    // item.completed with agent_message — primary Codex exec output format
    if (parsed.type === 'item.completed' && parsed.item) {
      const text = parsed.item.text || parsed.item.content || '';
      if (typeof text === 'string' && text) {
        return { text, isResult: false, source: 'assistant', raw: parsed };
      }
      // item might have nested content array
      if (Array.isArray(parsed.item.content)) {
        const textParts = parsed.item.content
          .filter((b: any) => b.type === 'text' || b.type === 'output_text')
          .map((b: any) => b.text || '');
        if (textParts.length > 0) {
          return { text: textParts.join(''), isResult: false, source: 'assistant', raw: parsed };
        }
      }
    }

    // response.completed — final response event
    if (parsed.type === 'response.completed' && parsed.response) {
      const output = parsed.response.output;
      if (Array.isArray(output)) {
        const textParts = output
          .filter((item: any) => item.type === 'message' || item.type === 'agent_message')
          .map((item: any) => item.text || item.content || '')
          .filter((t: string) => t);
        // Extract usage from response
        const usage = extractUsageFromParsed(parsed.response);
        if (textParts.length > 0) {
          return { text: textParts.join(''), isResult: true, source: 'result', raw: parsed, usage };
        }
      }
    }

    // Message content (older/alternative format)
    if (parsed.type === 'message' && parsed.content) {
      const text = typeof parsed.content === 'string'
        ? parsed.content
        : JSON.stringify(parsed.content);
      return { text, isResult: false, source: 'assistant', raw: parsed };
    }

    // Completion / final output
    if (parsed.type === 'completion' || parsed.type === 'done') {
      const text = parsed.text || parsed.message || parsed.content || '';
      return { text: typeof text === 'string' ? text : JSON.stringify(text), isResult: true, source: 'result', raw: parsed };
    }

    // Generic text extraction fallback
    if (parsed.text) {
      return { text: parsed.text, isResult: false, source: 'plain', raw: parsed };
    }

    return null;
  } catch {
    // Not JSON — treat as plain text
    return { text: trimmed, isResult: false, source: 'plain', raw: trimmed };
  }
}

/** Extract token usage from a parsed JSON object (Claude or Codex result events). */
function extractUsageFromParsed(parsed: any): ParsedUsage | undefined {
  // Claude CLI: { usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } }
  // Codex CLI: { usage: { input_tokens, output_tokens, ... } }
  const usage = parsed.usage;
  if (!usage || typeof usage !== 'object') return undefined;

  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;

  const result: ParsedUsage = { inputTokens, outputTokens };
  if (typeof usage.cache_read_input_tokens === 'number') {
    result.cacheReadTokens = usage.cache_read_input_tokens;
  }
  if (typeof usage.cache_creation_input_tokens === 'number') {
    result.cacheWriteTokens = usage.cache_creation_input_tokens;
  }
  return result;
}

/**
 * Detect clarifying questions in CLI JSONL output.
 *
 * For Claude: detects AskUserQuestion tool_use events in stream-json output.
 * For Codex: applies heuristic regex patterns against text content.
 *
 * Returns a ClarificationQuestion if detected, null otherwise.
 */
export function detectQuestions(
  jsonlLine: string,
  source: 'claude' | 'codex',
): import('../domain/types.js').ClarificationQuestion | null {
  const trimmed = jsonlLine.trim();
  if (!trimmed) return null;

  if (source === 'claude') {
    return detectClaudeQuestion(trimmed);
  }

  if (source === 'codex') {
    return detectCodexQuestion(trimmed);
  }

  return null;
}

function detectClaudeQuestion(trimmed: string): import('../domain/types.js').ClarificationQuestion | null {
  try {
    let parsed = JSON.parse(trimmed);

    // CLI 2.1.x wraps streaming events in {"type":"stream_event","event":{...}}
    if (parsed.type === 'stream_event' && parsed.event) {
      parsed = parsed.event;
    }

    // Check for AskUserQuestion tool_use in content_block_start
    if (
      parsed.type === 'content_block_start' &&
      parsed.content_block?.type === 'tool_use' &&
      parsed.content_block?.name === 'AskUserQuestion'
    ) {
      const input = parsed.content_block.input;
      const questionText =
        typeof input === 'string'
          ? input
          : input?.question || input?.questions?.[0]?.question || JSON.stringify(input);

      return {
        id: generateQuestionId(),
        source: 'claude',
        questionText,
        detectedVia: 'tool_use',
        answer: null,
        answeredAt: null,
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

function detectCodexQuestion(trimmed: string): import('../domain/types.js').ClarificationQuestion | null {
  // Heuristic patterns for question detection
  const patterns: RegExp[] = [
    /\b(?:Should I|Would you|Do you want|Which|What|How should|Can you clarify|Could you|Is it|Are there|Do we)\b[^?]*\?/i,
    /\b(?:QUESTION|CLARIFICATION NEEDED|Please clarify)\s*:?\s*.+\?/i,
  ];

  let text = trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    text = parsed.text || parsed.content || '';
    if (typeof text !== 'string') text = '';
  } catch {
    // Plain text — use as-is
  }

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return {
        id: generateQuestionId(),
        source: 'codex',
        questionText: match[0],
        detectedVia: 'heuristic',
        answer: null,
        answeredAt: null,
      };
    }
  }

  return null;
}

let questionCounter = 0;
function generateQuestionId(): string {
  questionCounter++;
  return `q-${Date.now()}-${questionCounter}`;
}

/**
 * Extract AskUserQuestion tool_use invocations from raw stream-json lines.
 *
 * When Claude tries to use AskUserQuestion in --print mode, the CLI auto-rejects
 * the tool but the tool_use content blocks are still emitted in the stream.
 * This function accumulates the input_json_delta fragments to reconstruct the
 * full question data.
 */
export function extractAskUserQuestions(rawLines: string[]): import('../domain/types.js').ClarificationQuestion[] {
  const questions: import('../domain/types.js').ClarificationQuestion[] = [];
  let trackingIndex: number | null = null;
  let fragments: string[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      let parsed = JSON.parse(trimmed);

      // CLI 2.1.x wraps streaming events in {"type":"stream_event","event":{...}}
      if (parsed.type === 'stream_event' && parsed.event) {
        parsed = parsed.event;
      }

      // Detect content_block_start for AskUserQuestion tool_use
      if (
        parsed.type === 'content_block_start' &&
        parsed.content_block?.type === 'tool_use' &&
        parsed.content_block?.name === 'AskUserQuestion'
      ) {
        trackingIndex = parsed.index ?? -1;
        fragments = [];
        continue;
      }

      // Accumulate input_json_delta fragments for the tracked tool_use
      if (
        trackingIndex !== null &&
        parsed.type === 'content_block_delta' &&
        parsed.index === trackingIndex &&
        parsed.delta?.type === 'input_json_delta' &&
        parsed.delta?.partial_json
      ) {
        fragments.push(parsed.delta.partial_json);
        continue;
      }

      // On content_block_stop, parse accumulated JSON to extract questions
      if (
        trackingIndex !== null &&
        parsed.type === 'content_block_stop' &&
        parsed.index === trackingIndex
      ) {
        try {
          const input = JSON.parse(fragments.join(''));
          // AskUserQuestion input shape: { questions: [{ question, options: [{ label, description }] }] }
          const questionsList: any[] = input.questions || [input];
          for (const q of questionsList) {
            const questionText = q.question || q.text || JSON.stringify(q);
            const options: { label: string; description: string }[] | undefined =
              Array.isArray(q.options)
                ? q.options.map((o: any) => ({ label: o.label || String(o), description: o.description || '' }))
                : undefined;
            questions.push({
              id: generateQuestionId(),
              source: 'claude',
              questionText,
              detectedVia: 'tool_use',
              answer: null,
              answeredAt: null,
              options,
            });
          }
        } catch {
          // Incomplete JSON — skip
        }
        trackingIndex = null;
        fragments = [];
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return questions;
}

/**
 * Extract inline clarification questions from agent response text.
 *
 * Detects <clarification_questions> ... </clarification_questions> blocks
 * containing a JSON array of questions. Returns the parsed questions and
 * the text with the block stripped out.
 */
export function extractInlineClarifications(text: string): {
  questions: import('../domain/types.js').ClarificationQuestion[];
  cleanedText: string;
} {
  const regex = /<clarification_questions>\s*([\s\S]*?)\s*<\/clarification_questions>/g;
  const questions: import('../domain/types.js').ClarificationQuestion[] = [];
  let cleanedText = text;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const items: any[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const questionText = item.question || item.text || JSON.stringify(item);
        const options: { label: string; description: string }[] | undefined =
          Array.isArray(item.options)
            ? item.options.map((o: any) => ({ label: o.label || String(o), description: o.description || '' }))
            : undefined;
        questions.push({
          id: generateQuestionId(),
          source: 'claude',
          questionText,
          detectedVia: 'heuristic',
          answer: null,
          answeredAt: null,
          options,
        });
      }
    } catch {
      // Invalid JSON — skip this block
    }
    cleanedText = cleanedText.replace(match[0], '');
  }

  return { questions, cleanedText: cleanedText.trim() };
}

export function extractFinalText(lines: string[], parser: (line: string) => ParsedChunk | null): string {
  const chunks: string[] = [];
  for (const line of lines) {
    const chunk = parser(line);
    if (chunk) {
      chunks.push(chunk.text);
    }
  }
  return chunks.join('');
}
