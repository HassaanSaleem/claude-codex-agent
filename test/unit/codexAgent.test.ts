import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAgent } from '../../src/infra/codexAgent.js';
import * as subprocessRunner from '../../src/infra/subprocessRunner.js';
import type { PipelineConfig } from '../../src/domain/types.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';

vi.mock('../../src/infra/subprocessRunner.js');

const mockConfig: PipelineConfig = {
  ...DEFAULT_CONFIG,
  codexCliPath: 'codex',
  codexModel: 'o3',
};

describe('CodexAgent', () => {
  let agent: CodexAgent;

  beforeEach(() => {
    agent = new CodexAgent();
    vi.resetAllMocks();
  });

  describe('verifyPlan', () => {
    it('spawns codex exec with read-only sandbox', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: 'PASS',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await agent.verifyPlan('Plan text', '/workspace', mockConfig, () => {});

      const call = vi.mocked(subprocessRunner.spawnStreaming).mock.calls[0];
      expect(call[0]).toBe('codex');
      expect(call[1]).toContain('exec');
      expect(call[1]).toContain('--sandbox');
      expect(call[1]).toContain('read-only');
      expect(call[1]).toContain('--json');
      expect(call[1]).toContain('-m');
      expect(call[1]).toContain('o3');
    });

    it('throws on CLI not found', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: '',
          stderr: 'not found',
          exitCode: 127,
          timedOut: false,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await expect(
        agent.verifyPlan('plan', '/workspace', mockConfig, () => {}),
      ).rejects.toThrow('not found');
    });
  });

  describe('chat', () => {
    it('spawns codex exec with read-only sandbox for chat', async () => {
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

      await agent.chat({ message: 'Explain this code', workspacePath: '/workspace', config: mockConfig, onStream: () => {} });

      const call = vi.mocked(subprocessRunner.spawnStreaming).mock.calls[0];
      expect(call[0]).toBe('codex');
      expect(call[1]).toContain('exec');
      expect(call[1]).toContain('--sandbox');
      expect(call[1]).toContain('read-only');
      expect(call[1]).toContain('--json');
    });
  });

  describe('audit', () => {
    it('spawns codex exec with read-only sandbox for audit', async () => {
      const mockHandle = {
        process: {} as any,
        result: Promise.resolve({
          stdout: 'PASS',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        }),
        kill: vi.fn(),
      };
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(mockHandle);

      await agent.audit('Plan + diff context', '/workspace', mockConfig, () => {});

      const call = vi.mocked(subprocessRunner.spawnStreaming).mock.calls[0];
      expect(call[1]).toContain('exec');
      expect(call[1]).toContain('--sandbox');
      expect(call[1]).toContain('read-only');
      expect(call[1]).toContain('--json');
      expect(call[1]).not.toContain('review');
      expect(call[1]).not.toContain('--uncommitted');
    });
  });
});
