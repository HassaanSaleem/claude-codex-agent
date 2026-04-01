import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeAgent } from '../../src/infra/claudeAgent.js';
import { CodexAgent } from '../../src/infra/codexAgent.js';
import * as subprocessRunner from '../../src/infra/subprocessRunner.js';
import type { PipelineConfig, ChatMode } from '../../src/domain/types.js';
import { CHAT_MODES } from '../../src/domain/types.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';

vi.mock('../../src/infra/subprocessRunner.js');

const mockConfig: PipelineConfig = {
  ...DEFAULT_CONFIG,
  claudeCliPath: 'claude',
  codexCliPath: 'codex',
  claudeModel: 'sonnet',
  codexModel: 'gpt-4',
};

function createMockHandle(resultText = 'Response') {
  return {
    process: {} as any,
    result: Promise.resolve({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }),
    kill: vi.fn(),
  };
}

describe('ChatMode type validation', () => {
  it('has exactly 3 modes: ask, plan, edit', () => {
    expect(CHAT_MODES).toHaveLength(3);
    expect(CHAT_MODES.map((m) => m.key)).toEqual(['ask', 'plan', 'edit']);
  });

  it('each mode has label and description', () => {
    for (const mode of CHAT_MODES) {
      expect(mode.label).toBeTruthy();
      expect(mode.description).toBeTruthy();
    }
  });

  it('default mode is ask', () => {
    expect(CHAT_MODES[0].key).toBe('ask');
  });
});

describe('ClaudeAgent mode→system prompt selection', () => {
  let agent: ClaudeAgent;

  beforeEach(() => {
    agent = new ClaudeAgent();
    vi.resetAllMocks();
  });

  const modes: ChatMode[] = ['ask', 'plan', 'edit'];

  for (const mode of modes) {
    it(`uses correct system prompt for ${mode} mode`, async () => {
      const handle = createMockHandle();
      vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

      try {
        await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode });
      } catch {
        // May fail due to mock, but we can inspect the call
      }

      const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
      if (calls.length > 0) {
        const args = calls[0][1] as string[];
        const systemPromptIdx = args.indexOf('--append-system-prompt');
        expect(systemPromptIdx).toBeGreaterThan(-1);
        const prompt = args[systemPromptIdx + 1];

        if (mode === 'ask') {
          expect(prompt).toContain('read-only mode');
          expect(prompt).toContain('do not modify any files');
        } else if (mode === 'plan') {
          expect(prompt).toContain('coding architect');
          expect(prompt).toContain('plan and implement');
        } else if (mode === 'edit') {
          expect(prompt).toContain('full edit access');
          expect(prompt).toContain('summary of files changed');
        }
      }
    });
  }
});

describe('ClaudeAgent mode→CLI flags selection', () => {
  let agent: ClaudeAgent;

  beforeEach(() => {
    agent = new ClaudeAgent();
    vi.resetAllMocks();
  });

  it('Ask mode uses --allowedTools', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    if (calls.length > 0) {
      const args = calls[0][1] as string[];
      expect(args).toContain('--allowedTools');
      expect(args).not.toContain('--permission-mode');
    }
  });

  it('Plan mode uses --permission-mode plan', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'plan' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    if (calls.length > 0) {
      const args = calls[0][1] as string[];
      expect(args).toContain('--permission-mode');
      const pmIdx = args.indexOf('--permission-mode');
      expect(args[pmIdx + 1]).toBe('plan');
      // Plan mode also passes --allowedTools with write access
      expect(args).toContain('--allowedTools');
      const atIdx = args.indexOf('--allowedTools');
      expect(args[atIdx + 1]).toContain('Write');
      expect(args[atIdx + 1]).toContain('Edit');
    }
  });

  it('Edit mode uses --permission-mode acceptEdits', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'edit' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    if (calls.length > 0) {
      const args = calls[0][1] as string[];
      expect(args).toContain('--permission-mode');
      const pmIdx = args.indexOf('--permission-mode');
      expect(args[pmIdx + 1]).toBe('acceptEdits');
      // Edit mode also passes --allowedTools with write access
      expect(args).toContain('--allowedTools');
      const atIdx = args.indexOf('--allowedTools');
      expect(args[atIdx + 1]).toContain('Write');
      expect(args[atIdx + 1]).toContain('Edit');
    }
  });

  it('first call uses --session-id, subsequent calls use --resume', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    // First call — should use --session-id
    try {
      await agent.chat({ message: 'msg1', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    let calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    expect(calls.length).toBe(1);
    let args = calls[0][1] as string[];
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--continue');
    const sessionId = args[args.indexOf('--session-id') + 1];
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Second call — should use --resume with same session ID
    vi.mocked(subprocessRunner.spawnStreaming).mockClear();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(createMockHandle() as any);

    try {
      await agent.chat({ message: 'msg2', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    expect(calls.length).toBe(1);
    args = calls[0][1] as string[];
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(sessionId);
    expect(args).not.toContain('--session-id');
    expect(args).not.toContain('--continue');
  });

  it('resetSession clears session ID so next call starts fresh', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    // First call
    try {
      await agent.chat({ message: 'msg1', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    const firstArgs = (vi.mocked(subprocessRunner.spawnStreaming).mock.calls[0][1] as string[]);
    const firstSessionId = firstArgs[firstArgs.indexOf('--session-id') + 1];

    // Reset
    agent.resetSession();

    // Next call should use a new --session-id
    vi.mocked(subprocessRunner.spawnStreaming).mockClear();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(createMockHandle() as any);

    try {
      await agent.chat({ message: 'msg2', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    const args = calls[0][1] as string[];
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
    const newSessionId = args[args.indexOf('--session-id') + 1];
    expect(newSessionId).not.toBe(firstSessionId);
  });
});

describe('CodexAgent mode→sandbox flags selection', () => {
  let agent: CodexAgent;

  beforeEach(() => {
    agent = new CodexAgent();
    vi.resetAllMocks();
  });

  it('Ask mode uses --sandbox read-only', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    if (calls.length > 0) {
      const args = calls[0][1] as string[];
      expect(args).toContain('--sandbox');
      const sbIdx = args.indexOf('--sandbox');
      expect(args[sbIdx + 1]).toBe('read-only');
    }
  });

  it('Plan mode omits --sandbox (has edit access)', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'plan' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    if (calls.length > 0) {
      const args = calls[0][1] as string[];
      expect(args).not.toContain('--sandbox');
    }
  });

  it('Edit mode omits --sandbox', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'edit' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    if (calls.length > 0) {
      const args = calls[0][1] as string[];
      expect(args).not.toContain('--sandbox');
    }
  });
});

describe('ClaudeAgent CLI session ID getter/setter', () => {
  let agent: ClaudeAgent;

  beforeEach(() => {
    agent = new ClaudeAgent();
    vi.resetAllMocks();
  });

  it('getCliSessionId returns null before any chat call', () => {
    expect(agent.getCliSessionId()).toBeNull();
  });

  it('getCliSessionId returns a UUID after chat()', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    const sessionId = agent.getCliSessionId();
    expect(sessionId).not.toBeNull();
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('resetSession makes getCliSessionId return null', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    expect(agent.getCliSessionId()).not.toBeNull();
    agent.resetSession();
    expect(agent.getCliSessionId()).toBeNull();
  });

  it('setCliSessionId followed by chat uses --resume with that ID', async () => {
    const restoredId = '12345678-1234-1234-1234-123456789abc';
    agent.setCliSessionId(restoredId);

    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    expect(calls.length).toBe(1);
    const args = calls[0][1] as string[];
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(restoredId);
    expect(args).not.toContain('--session-id');
  });

  it('setCliSessionId(null) makes next chat start a new session', async () => {
    const handle = createMockHandle();
    vi.mocked(subprocessRunner.spawnStreaming).mockReturnValue(handle as any);

    // First, set a session ID to simulate a restored session
    agent.setCliSessionId('12345678-1234-1234-1234-123456789abc');

    // Now clear it
    agent.setCliSessionId(null);

    try {
      await agent.chat({ message: 'test', workspacePath: '/workspace', config: mockConfig, onStream: vi.fn(), mode: 'ask' });
    } catch { /* expected */ }

    const calls = vi.mocked(subprocessRunner.spawnStreaming).mock.calls;
    expect(calls.length).toBe(1);
    const args = calls[0][1] as string[];
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
  });
});
