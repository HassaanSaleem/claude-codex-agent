import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeAgent } from '../../src/infra/claudeAgent.js';
import * as subprocessRunner from '../../src/infra/subprocessRunner.js';
import type { PipelineConfig } from '../../src/domain/types.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';

vi.mock('../../src/infra/subprocessRunner.js');

const mockConfig: PipelineConfig = {
  ...DEFAULT_CONFIG,
  claudeCliPath: 'claude',
  claudeModel: 'sonnet',
};

describe('ClaudeAgent', () => {
  let agent: ClaudeAgent;

  beforeEach(() => {
    agent = new ClaudeAgent();
    vi.resetAllMocks();
  });

  describe('plan', () => {
    it('spawns claude CLI with correct flags for plan stage', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: JSON.stringify({ type: 'result', result: 'Plan output' }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await agent.plan('Add health check', '/workspace', mockConfig, () => {});

      const call = vi.mocked(subprocessRunner.spawnStreaming).mock.calls[0];
      expect(call[0]).toBe('claude');
      expect(call[1]).toContain('--print');
      expect(call[1]).toContain('--output-format');
      expect(call[1]).toContain('stream-json');
      expect(call[1]).toContain('--model');
      expect(call[1]).toContain('sonnet');
      expect(call[1]).toContain('--allowedTools');
    });

    it('throws on CLI not found (exit code 127)', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: '',
          stderr: 'command not found',
          exitCode: 127,
          timedOut: false,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await expect(
        agent.plan('task', '/workspace', mockConfig, () => {}),
      ).rejects.toThrow('not found');
    });

    it('throws on timeout', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: '',
          stderr: '',
          exitCode: 1,
          timedOut: true,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await expect(
        agent.plan('task', '/workspace', mockConfig, () => {}),
      ).rejects.toThrow('timed out');
    });
  });

  describe('chat', () => {
    it('spawns claude CLI with read-only tools for chat', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: 'chat response',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await agent.chat({ message: 'Explain this function', workspacePath: '/workspace', config: mockConfig, onStream: () => {} });

      const call = vi.mocked(subprocessRunner.spawnStreaming).mock.calls[0];
      expect(call[0]).toBe('claude');
      expect(call[1]).toContain('--print');
      expect(call[1]).toContain('--allowedTools');
      // Verify read-only tools only
      const allowedToolsIdx = call[1].indexOf('--allowedTools');
      expect(call[1][allowedToolsIdx + 1]).toBe('Read Glob Grep');
      // Verify no dangerous permissions
      expect(call[1]).not.toContain('--dangerously-skip-permissions');
    });
  });

  describe('implement', () => {
    it('spawns claude CLI with dangerous permissions for implement stage', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: 'implementation output',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await agent.implement('plan context', '/workspace', mockConfig, () => {});

      const call = vi.mocked(subprocessRunner.spawnStreaming).mock.calls[0];
      expect(call[1]).toContain('--dangerously-skip-permissions');
    });
  });
});
