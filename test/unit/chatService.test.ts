import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService, type ChatCallbacks, type PersistFns } from '../../src/services/chatService.js';
import type { IClaudeAgent, ICodexAgent } from '../../src/domain/interfaces.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';

type MockClaudeAgent = IClaudeAgent & { kill: ReturnType<typeof vi.fn>; resetSession: ReturnType<typeof vi.fn>; getCliSessionId: ReturnType<typeof vi.fn>; setCliSessionId: ReturnType<typeof vi.fn> };
type MockCodexAgent = ICodexAgent & { kill: ReturnType<typeof vi.fn>; resetSession: ReturnType<typeof vi.fn> };

describe('ChatService', () => {
  let claudeAgent: MockClaudeAgent;
  let codexAgent: MockCodexAgent;
  let chatService: ChatService;
  let callbacks: ChatCallbacks;
  let persistFns: PersistFns;
  const config = { ...DEFAULT_CONFIG };

  beforeEach(() => {
    claudeAgent = {
      plan: vi.fn(),
      fixPlan: vi.fn(),
      implement: vi.fn(),
      chat: vi.fn().mockResolvedValue('Claude says hello'),
      generateSpecDocs: vi.fn().mockResolvedValue(''),
      kill: vi.fn(),
      resetSession: vi.fn(),
      getCliSessionId: vi.fn().mockReturnValue(null),
      setCliSessionId: vi.fn(),
    };

    codexAgent = {
      verifyPlan: vi.fn(),
      audit: vi.fn(),
      chat: vi.fn().mockResolvedValue('Codex says hello'),
      kill: vi.fn(),
      resetSession: vi.fn(),
    };

    chatService = new ChatService(claudeAgent, codexAgent);

    persistFns = {
      persistSessions: vi.fn(),
      persistMessages: vi.fn(),
      deleteMessages: vi.fn(),
    };
    chatService.setPersistFns(persistFns);

    callbacks = {
      onStreamChunk: vi.fn(),
      onStreamEnd: vi.fn(),
      onError: vi.fn(),
    };
  });

  it('defaults to claude agent', () => {
    expect(chatService.getAgent()).toBe('claude');
  });

  it('switches agent', () => {
    chatService.setAgent('codex');
    expect(chatService.getAgent()).toBe('codex');
  });

  it('sends message to claude agent by default', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);

    expect(claudeAgent.chat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Hello',
      workspacePath: '/workspace',
      config,
      mode: 'ask',
    }));
    expect(codexAgent.chat).not.toHaveBeenCalled();
  });

  it('sends message to codex agent when switched', async () => {
    chatService.setAgent('codex');
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);

    expect(codexAgent.chat).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Hello'),
      workspacePath: '/workspace',
      config,
      mode: 'ask',
    }));
    expect(claudeAgent.chat).not.toHaveBeenCalled();
  });

  it('tracks message history', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);

    const history = chatService.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('Hello');
    expect(history[1].role).toBe('assistant');
    expect(history[1].agent).toBe('claude');
  });

  it('calls onStreamEnd when message completes', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);

    expect(callbacks.onStreamEnd).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
    );
  });

  it('calls onError when agent throws', async () => {
    vi.mocked(claudeAgent.chat).mockRejectedValue(new Error('CLI not found'));

    await chatService.sendMessage('Hello', '/workspace', config, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.any(String),
      'CLI not found',
    );
  });

  it('cancels both agents on cancelActiveChat', async () => {
    // Simulate an in-progress chat by making the agent hang
    vi.mocked(claudeAgent.chat).mockImplementation(() => new Promise(() => {}));

    const promise = chatService.sendMessage('Hello', '/workspace', config, callbacks);
    chatService.cancelActiveChat();

    expect(claudeAgent.kill).toHaveBeenCalled();
    expect(codexAgent.kill).toHaveBeenCalled();

    // Clean up — the promise is dangling, but that's OK for the test
  });

  it('returns a copy of history, not the internal array', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);

    const history1 = chatService.getHistory();
    const history2 = chatService.getHistory();
    expect(history1).not.toBe(history2);
    expect(history1).toEqual(history2);
  });

  // ── Session management tests ──

  it('has an activeSessionId on construction', () => {
    expect(chatService.getActiveSessionId()).toBeTruthy();
  });

  it('createSession creates a new session and clears messages', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);
    expect(chatService.getHistory().length).toBe(2);

    const session = chatService.createSession();
    expect(session.title).toBe('New Chat');
    expect(chatService.getHistory()).toEqual([]);
    expect(chatService.getActiveSessionId()).toBe(session.id);
    expect(chatService.getSessions().length).toBeGreaterThanOrEqual(1);
  });

  it('clearHistory creates a new session and preserves old one in list', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);
    const oldSessionId = chatService.getActiveSessionId();

    chatService.clearHistory();

    expect(chatService.getHistory()).toEqual([]);
    expect(chatService.getActiveSessionId()).not.toBe(oldSessionId);
    // Old session should be in the list
    const sessions = chatService.getSessions();
    expect(sessions.some((s) => s.id === oldSessionId)).toBe(true);
  });

  it('switchSession loads new messages and resets agents', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);
    const sessionA = chatService.getActiveSessionId();

    const sessionB = chatService.createSession();
    claudeAgent.resetSession.mockClear();
    codexAgent.resetSession.mockClear();

    const fakeMsgs = [{ id: 'x', role: 'user' as const, content: 'Old msg', timestamp: '2025-01-01T00:00:00Z' }];
    chatService.switchSession(sessionA, fakeMsgs);

    expect(chatService.getActiveSessionId()).toBe(sessionA);
    expect(chatService.getHistory()).toEqual(fakeMsgs);
    expect(claudeAgent.resetSession).toHaveBeenCalled();
    expect(codexAgent.resetSession).toHaveBeenCalled();
  });

  it('deleteSession removes session and switches if active', () => {
    const session1 = chatService.createSession();
    const session2 = chatService.createSession();

    const result = chatService.deleteSession(session2.id);

    expect(chatService.getSessions().some((s) => s.id === session2.id)).toBe(false);
    expect(result.switchedTo).toBeTruthy();
  });

  it('renameSession updates the session title', () => {
    const session = chatService.createSession();
    chatService.renameSession(session.id, 'My Custom Title');

    const found = chatService.getSessions().find((s) => s.id === session.id);
    expect(found?.title).toBe('My Custom Title');
  });

  it('auto-sets session title from first user message', async () => {
    // Create a session so it appears in the list
    const session = chatService.createSession();

    await chatService.sendMessage('What is the weather today?', '/workspace', config, callbacks);

    const found = chatService.getSessions().find((s) => s.id === session.id);
    expect(found?.title).toBe('What is the weather today?');
  });

  it('persists sessions and messages separately', async () => {
    await chatService.sendMessage('Hello', '/workspace', config, callbacks);

    expect(persistFns.persistMessages).toHaveBeenCalled();
  });

  it('deleteSession calls deleteMessages for removed session', () => {
    const session = chatService.createSession();
    const sessionId = session.id;

    // Create another session so deletion doesn't leave empty list
    chatService.createSession();

    chatService.deleteSession(sessionId);

    expect(persistFns.deleteMessages).toHaveBeenCalledWith(sessionId);
  });

  // ── Pinned files tests (010-pinned-files) ──

  it('starts with no pinned files', () => {
    expect(chatService.getPinnedFiles()).toEqual([]);
  });

  it('pins and unpins files', () => {
    chatService.createSession();
    const pinned = chatService.pinFile('src/main.ts');
    expect(pinned).toEqual(['src/main.ts']);
    expect(chatService.getPinnedFiles()).toEqual(['src/main.ts']);

    const after = chatService.unpinFile('src/main.ts');
    expect(after).toEqual([]);
    expect(chatService.getPinnedFiles()).toEqual([]);
  });

  it('does not duplicate pinned files', () => {
    chatService.createSession();
    chatService.pinFile('src/main.ts');
    chatService.pinFile('src/main.ts');
    expect(chatService.getPinnedFiles()).toEqual(['src/main.ts']);
  });

  // ── Session search tests (011-session-search) ──

  it('searchSessions returns all sessions for empty query', () => {
    chatService.createSession();
    chatService.createSession();
    const all = chatService.searchSessions('');
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('searchSessions filters by title', async () => {
    const s1 = chatService.createSession();
    chatService.renameSession(s1.id, 'Weather Report');

    const s2 = chatService.createSession();
    chatService.renameSession(s2.id, 'Code Review');

    const results = chatService.searchSessions('weather');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Weather Report');
  });

  // ── Token usage tests (007-token-cost-tracking) ──

  it('passes onTokenUsage callback to claude agent', async () => {
    const onTokenUsage = vi.fn();
    await chatService.sendMessage('Hello', '/workspace', config, { ...callbacks, onTokenUsage });

    // Verify the options object contains an onTokenUsage callback
    const chatOptions = claudeAgent.chat.mock.calls[0][0];
    expect(typeof chatOptions.onTokenUsage).toBe('function');
  });
});
