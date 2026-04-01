import type { PipelineConfig, ChatMode, TokenUsage } from '../domain/types.js';
import type { ICodexAgent, StreamCallback, TokenUsageCallback, CodexChatOptions } from '../domain/interfaces.js';
import { spawnStreaming, type StreamingHandle } from './subprocessRunner.js';
import { parseCodexStreamLine } from '../utils/cliOutputParser.js';

export class CodexAgent implements ICodexAgent {
  private activeHandle: StreamingHandle | null = null;

  async verifyPlan(
    planText: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    const prompt = [
      'Review the following plan for completeness, missing tests, logical issues, and risks.',
      'Return your verdict clearly: PASS if the plan is solid, or REVISE if there are blocking issues.',
      'List any blocking issues, missing tests, and suggestions.',
      '',
      '## Plan to Review',
      planText,
    ].join('\n');

    const args = this.buildExecArgs(config, {
      prompt,
      sandbox: 'read-only',
    });

    return this.invoke(config.codexCliPath, args, '', workspacePath, config, onStream, signal, onTokenUsage);
  }

  async audit(
    context: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    const prompt = [
      'Audit the implementation against the plan and diff below.',
      'Check for: spec drift (deviations from plan), risky code patterns, missing test coverage, and security issues.',
      'Ignore changes to tooling/config files (.gitignore, .claude/, .vscode/, specs/) — these are not spec drift.',
      '',
      'VERDICT FORMAT: Your final verdict MUST be on its own line, either:',
      '  PASS',
      '  FIX_REQUIRED',
      'Do NOT write "FIX_REQUIRED" anywhere else in your response (not in your methodology, preamble, or analysis).',
      'Only use it as the final verdict line.',
      '',
      context,
    ].join('\n');

    const args = this.buildExecArgs(config, {
      prompt,
      sandbox: 'read-only',
    });

    return this.invoke(config.codexCliPath, args, '', workspacePath, config, onStream, signal, onTokenUsage);
  }

  private static readonly MODE_PROMPTS: Record<ChatMode, string> = {
    ask: 'You are a helpful coding assistant. Answer questions about the codebase, explain code, and help with planning. You are in read-only mode — do not modify any files.',
    plan: 'You are a coding architect. Analyze the workspace, produce a structured implementation plan including files to create/modify, step-by-step approach, and test requirements, then implement the plan directly.',
    edit: 'You are a coding assistant with full edit access. Make the requested code changes directly. After making changes, include a summary of files created, modified, or deleted.',
  };

  async chat(options: CodexChatOptions): Promise<string> {
    const { message, workspacePath, config, onStream, mode = 'ask', modelOverride, onTokenUsage } = options;

    const systemPrompt = CodexAgent.MODE_PROMPTS[mode];
    const promptWithSystem = `${systemPrompt}\n\n${message}`;

    const args = this.buildExecArgs(config, {
      prompt: promptWithSystem,
      sandbox: mode === 'ask' ? 'read-only' : undefined,
      ephemeral: false,
      modelOverride,
    });

    return this.invoke(config.codexCliPath, args, '', workspacePath, config, onStream, undefined, onTokenUsage);
  }

  kill(): void {
    this.activeHandle?.kill();
    this.activeHandle = null;
  }

  resetSession(): void {
    // Codex doesn't have native session continuation like Claude --continue,
    // but clearing any future session state would happen here.
  }

  private buildExecArgs(
    config: PipelineConfig,
    options: {
      prompt: string;
      sandbox?: string;
      ephemeral?: boolean;
      modelOverride?: string;
    },
  ): string[] {
    const args = [
      'exec',
      '--json',
      '--full-auto',
      '-c', 'model_reasoning_effort="medium"',
    ];

    // Default to ephemeral (one-shot) unless explicitly set to false (chat mode)
    if (options.ephemeral !== false) {
      args.push('--ephemeral');
    }

    if (options.sandbox) {
      args.push('--sandbox', options.sandbox);
    }

    const model = options.modelOverride ?? config.codexModel;
    if (model) {
      args.push('-m', model);
    }

    args.push(options.prompt);
    return args;
  }

  private async invoke(
    cliPath: string,
    args: string[],
    stdin: string,
    workspacePath: string,
    config: PipelineConfig,
    onStream: StreamCallback,
    signal?: AbortSignal,
    onTokenUsage?: TokenUsageCallback,
  ): Promise<string> {
    const streamedTexts: string[] = [];
    let resultText = '';
    let lineBuffer = '';

    const handle = spawnStreaming(cliPath, ['-C', workspacePath, ...args], {
      cwd: workspacePath,
      timeoutMs: config.cliTimeoutSeconds * 1000,
      stdin,
      signal,
      onStdout: (chunk) => {
        // Accumulate partial lines across chunks to prevent split JSON
        const data = lineBuffer + chunk;
        const lines = data.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = parseCodexStreamLine(line);
          if (!parsed) continue;

          if (parsed.source === 'result') {
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
          } else {
            // Each Codex item.completed is a complete content block —
            // ensure blocks are separated so markdown renders correctly
            const text = parsed.text.endsWith('\n') ? parsed.text : parsed.text + '\n\n';
            onStream(text);
            streamedTexts.push(text);
          }
        }
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
      throw new Error(`Codex CLI timed out after ${config.cliTimeoutSeconds}s`);
    }

    if (result.exitCode === 127) {
      throw new Error(`Codex CLI not found at '${cliPath}'. Install with: npm install -g @openai/codex`);
    }

    if (result.exitCode !== 0) {
      throw new Error(`Codex CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }

    // Prefer result text (authoritative), fall back to accumulated streamed text
    return resultText || streamedTexts.join('');
  }
}
