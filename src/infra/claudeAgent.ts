import { randomUUID } from 'node:crypto';
import type { PipelineConfig, ClarificationQuestion, ChatMode, TokenUsage } from '../domain/types.js';
import type { IClaudeAgent, StreamCallback, TokenUsageCallback, ClaudeChatOptions } from '../domain/interfaces.js';
import { SPECKIT_SYSTEM_PROMPT } from '../domain/constants.js';
import { spawnStreaming, type StreamingHandle } from './subprocessRunner.js';
import { parseClaudeStreamLine, extractAskUserQuestions } from '../utils/cliOutputParser.js';

export class ClaudeAgent implements IClaudeAgent {
  private activeHandle: StreamingHandle | null = null;
  private cliSessionId: string | null = null;

  /** Get session args — first call creates a session, subsequent calls resume it. */
  private ensureSessionArgs(): { sessionId?: string; resumeSessionId?: string } {
    if (this.cliSessionId === null) {
      this.cliSessionId = randomUUID();
      return { sessionId: this.cliSessionId };
    }
    return { resumeSessionId: this.cliSessionId };
  }

  async plan(
    taskDescription: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    const args = this.buildArgs(config, {
      systemPrompt: 'You are in PLAN mode. Analyze the task and workspace context (including CLAUDE.md, project structure, existing code). Produce a structured implementation plan including: files to create/modify/delete, test requirements, and step-by-step approach. Output the plan as markdown.',
      allowedTools: 'Read Glob Grep',
      ...this.ensureSessionArgs(),
    });

    return this.invoke(args, taskDescription, workspacePath, config, onStream, signal, undefined, undefined, onTokenUsage);
  }

  async fixPlan(
    planText: string,
    reviewFeedback: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    const args = this.buildArgs(config, {
      systemPrompt: 'You are in PLAN REVISION mode. You will receive an existing plan and review feedback. Revise the plan to address all blocking issues and suggestions from the review. Output the revised plan as markdown. Do not implement — only revise the plan.',
      allowedTools: 'Read Glob Grep',
      ...this.ensureSessionArgs(),
    });

    const stdin = [
      '## Current Plan',
      planText,
      '',
      '## Review Feedback',
      reviewFeedback,
      '',
      '## Instructions',
      'Revise the plan to address all issues raised in the review feedback. Output the complete revised plan.',
    ].join('\n');

    return this.invoke(args, stdin, workspacePath, config, onStream, signal, undefined, undefined, onTokenUsage);
  }

  async implement(
    context: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    const args = this.buildArgs(config, {
      systemPrompt: 'Implement the plan provided via stdin. Apply all changes to the workspace using Edit/Write tools. IMPORTANT: Strictly follow the plan — only modify files listed in the plan, only create/update tests specified in the plan, and do not add extra tests, refactors, or configuration changes beyond what the plan calls for. Do not ask for confirmation — execute all changes directly.',
      dangerouslySkipPermissions: true,
      ...this.ensureSessionArgs(),
    });

    return this.invoke(args, context, workspacePath, config, onStream, signal, undefined, undefined, onTokenUsage);
  }

  async generateSpecDocs(
    context: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    const args = this.buildArgs(config, {
      systemPrompt: SPECKIT_SYSTEM_PROMPT,
      allowedTools: 'Read Glob Grep',
      ...this.ensureSessionArgs(),
    });

    return this.invoke(args, context, workspacePath, config, onStream, signal, undefined, undefined, onTokenUsage);
  }

  private static readonly CLARIFICATION_SUFFIX = `

IMPORTANT: Do NOT use the AskUserQuestion tool — it will fail silently in this mode.
Instead, when you need to ask the user a clarifying question with selectable options, embed it in your response using this exact format:

<clarification_questions>
[{"question":"Your question here?","options":[{"label":"Option A","description":"Description of option A"},{"label":"Option B","description":"Description of option B"}]}]
</clarification_questions>

The system will render this as an interactive dialog with clickable buttons. You can include multiple questions in the array. Always provide 2-4 options per question. You may include normal text before and after the clarification block.`;

  private static readonly MODE_PROMPTS: Record<ChatMode, string> = {
    ask: `You are a helpful coding assistant. Answer questions about the codebase, explain code, and help with planning. You are in read-only mode — do not modify any files.`,
    plan: `You are a coding architect. Analyze the workspace and the user's request, then plan and implement.

First, produce a structured implementation plan including:
- Files to create, modify, or delete
- Step-by-step implementation approach
- Test requirements and approach
- Potential risks or edge cases

Then implement the plan — make the code changes directly.`,
    edit: `You are a coding assistant with full edit access to the workspace. Make the requested code changes directly using Edit, Write, and other tools.

After making changes, ALWAYS include a summary of files changed:
- Files created: [list]
- Files modified: [list]
- Files deleted: [list]

If the user asks a read-only question (e.g., "explain this function"), answer it without making unnecessary file changes.`,
  };

  async chat(options: ClaudeChatOptions): Promise<string> {
    const {
      message, workspacePath, config, onStream,
      onThinkingStream, onQuestionsDetected,
      mode = 'ask', modelOverride, onTokenUsage,
    } = options;

    const systemPrompt = ClaudeAgent.MODE_PROMPTS[mode] + ClaudeAgent.CLARIFICATION_SUFFIX;

    const sessionArgs = this.ensureSessionArgs();

    let allowedTools: string;
    let permissionMode: string | undefined;
    if (mode === 'plan') {
      allowedTools = 'Read Write Edit Glob Grep Bash';
      permissionMode = 'plan';
    } else if (mode === 'edit') {
      allowedTools = 'Read Write Edit Glob Grep Bash';
      permissionMode = 'acceptEdits';
    } else {
      allowedTools = 'Read Glob Grep';
    }

    const args = this.buildArgs(config, {
      systemPrompt,
      allowedTools,
      permissionMode,
      modelOverride,
      ...sessionArgs,
    });

    const rawLines: string[] | undefined = onQuestionsDetected ? [] : undefined;
    const result = await this.invoke(args, message, workspacePath, config, onStream, undefined, onThinkingStream, rawLines, onTokenUsage);

    // Detect AskUserQuestion tool_use in the raw stream lines
    if (onQuestionsDetected && rawLines) {
      const questions = extractAskUserQuestions(rawLines);
      if (questions.length > 0) {
        onQuestionsDetected(questions);
      }
    }

    return result;
  }

  kill(): void {
    this.activeHandle?.kill();
    this.activeHandle = null;
  }

  resetSession(): void {
    this.cliSessionId = null;
  }

  getCliSessionId(): string | null {
    return this.cliSessionId;
  }

  setCliSessionId(id: string | null): void {
    this.cliSessionId = id;
  }

  private buildArgs(
    config: PipelineConfig,
    options: {
      systemPrompt: string;
      allowedTools?: string;
      dangerouslySkipPermissions?: boolean;
      permissionMode?: string;
      sessionId?: string;
      resumeSessionId?: string;
      modelOverride?: string;
    },
  ): string[] {
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--effort', 'medium',
      '--append-system-prompt', options.systemPrompt,
    ];

    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    } else if (options.sessionId) {
      args.push('--session-id', options.sessionId);
    }

    const model = options.modelOverride ?? config.claudeModel;
    if (model) {
      args.push('--model', model);
    }

    if (options.allowedTools) {
      args.push('--allowedTools', options.allowedTools);
    }

    if (options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.permissionMode) {
      args.push('--permission-mode', options.permissionMode);
    }

    return args;
  }

  private async invoke(
    args: string[],
    stdin: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onThinkingStream?: StreamCallback,
    rawLinesCollector?: string[],
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    // Track streamed text separately from the final result to avoid duplication.
    // With --include-partial-messages, Claude CLI emits content_block_delta events
    // for real-time streaming. Without it (fallback), only assistant messages arrive
    // after each turn. We prefer deltas when available; otherwise stream assistant messages.
    const streamedTexts: string[] = [];
    let resultText = '';
    let sawDeltas = false;
    let lineBuffer = '';

    console.log(`[ClaudeAgent] Spawning: ${config.claudeCliPath} ${args.join(' ')}`);

    const handle = spawnStreaming(config.claudeCliPath, args, {
      cwd: workspacePath,
      timeoutMs: config.cliTimeoutSeconds * 1000,
      stdin,
      signal,
      onStdout: (chunk) => {
        // Accumulate partial lines across chunks to prevent split JSON
        const data = lineBuffer + chunk;
        const lines = data.split('\n');
        lineBuffer = lines.pop() ?? ''; // Last element is incomplete (or empty if chunk ends with \n)
        for (const line of lines) {
          if (rawLinesCollector) rawLinesCollector.push(line);
          const parsed = parseClaudeStreamLine(line);
          if (!parsed) continue;

          if (parsed.source === 'thinking') {
            // Thinking delta — stream to thinking callback if provided
            onThinkingStream?.(parsed.text);
          } else if (parsed.source === 'delta') {
            // Incremental streaming text — always stream
            sawDeltas = true;
            onStream(parsed.text);
            streamedTexts.push(parsed.text);
          } else if (parsed.source === 'assistant') {
            if (sawDeltas) {
              // Deltas already streamed this turn's text — don't duplicate.
              // But inject a paragraph break so the next turn's deltas don't
              // run into the previous turn's text without separation.
              onStream('\n\n');
              streamedTexts.push('\n\n');
            } else {
              // No deltas received — stream the full assistant message (fallback).
              const text = parsed.text.endsWith('\n') ? parsed.text : parsed.text + '\n\n';
              onStream(text);
              streamedTexts.push(text);
            }
          } else if (parsed.source === 'result') {
            // Final result — store for return value, don't stream (would duplicate)
            resultText = parsed.text;
            // Emit token usage if present (007-token-cost-tracking)
            if (parsed.usage && onTokenUsage) {
              const usage: TokenUsage = {
                inputTokens: parsed.usage.inputTokens,
                outputTokens: parsed.usage.outputTokens,
                totalTokens: parsed.usage.inputTokens + parsed.usage.outputTokens,
                cacheReadTokens: parsed.usage.cacheReadTokens,
                cacheWriteTokens: parsed.usage.cacheWriteTokens,
              };
              onTokenUsage(usage);
            }
          }
          // Ignore 'plain' — with --output-format stream-json, non-JSON lines are
          // artifacts from --include-partial-messages concatenating user/tool_result
          // messages without newline separation. Streaming them shows raw garbage.
        }
      },
      onStderr: (chunk) => {
        console.log(`[ClaudeAgent] stderr: ${chunk.trim()}`);
      },
    });

    this.activeHandle = handle;
    let result;
    try {
      result = await handle.result;
    } finally {
      this.activeHandle = null;
    }

    if (result.timedOut) {
      throw new Error(`Claude Code CLI timed out after ${config.cliTimeoutSeconds}s`);
    }

    if (result.exitCode === 127) {
      throw new Error(`Claude Code CLI not found at '${config.claudeCliPath}'. Install with: npm install -g @anthropic-ai/claude-code`);
    }

    if (result.exitCode !== 0) {
      throw new Error(`Claude Code CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }

    // When we streamed via deltas, those are the most accurate representation
    // (result text can contain duplicated content blocks from multi-turn tool use).
    // Only fall back to resultText when no deltas/streaming was captured.
    if (sawDeltas && streamedTexts.length > 0) {
      return streamedTexts.join('');
    }
    return resultText || streamedTexts.join('');
  }
}
