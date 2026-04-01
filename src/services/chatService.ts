import * as crypto from 'node:crypto';
import type { PipelineConfig, AgentType, ChatMode, ChatMessage, ChatSession, ClarificationQuestion, TokenUsage } from '../domain/types.js';
import type { IClaudeAgent, ICodexAgent } from '../domain/interfaces.js';
import { extractInlineClarifications } from '../utils/cliOutputParser.js';

export interface ChatCallbacks {
  onStreamChunk: (messageId: string, text: string) => void;
  onStreamEnd: (messageId: string, finalText: string) => void;
  onError: (messageId: string, error: string) => void;
  onThinkingChunk?: (messageId: string, text: string) => void;
  onQuestionsDetected?: (questions: ClarificationQuestion[]) => void;
  onTokenUsage?: (messageId: string, usage: TokenUsage) => void;
}

export interface PersistFns {
  persistSessions: (sessions: ChatSession[]) => void;
  persistMessages: (sessionId: string, messages: ChatMessage[]) => void;
  deleteMessages: (sessionId: string) => void;
}

export class ChatService {
  private messages: ChatMessage[] = [];
  private currentAgent: AgentType = 'claude';
  private currentMode: ChatMode = 'ask';
  private currentModel: string | null = null;  // null = use config default
  private isStreaming = false;
  private persistFns: PersistFns | null = null;

  // Session management
  private sessions: ChatSession[] = [];
  private activeSessionId: string;

  constructor(
    private claudeAgent: IClaudeAgent & { kill(): void; resetSession(): void; getCliSessionId(): string | null; setCliSessionId(id: string | null): void },
    private codexAgent: ICodexAgent & { kill(): void; resetSession(): void },
  ) {
    this.activeSessionId = crypto.randomBytes(8).toString('hex');
  }

  setPersistFns(fns: PersistFns): void {
    this.persistFns = fns;
  }

  loadSessions(sessions: ChatSession[]): void {
    this.sessions = sessions;
  }

  loadHistory(messages: ChatMessage[]): void {
    this.messages = messages;
  }

  setActiveSessionId(id: string): void {
    this.activeSessionId = id;
  }

  getActiveSessionId(): string {
    return this.activeSessionId;
  }

  getSessions(): ChatSession[] {
    return [...this.sessions];
  }

  getAgent(): AgentType {
    return this.currentAgent;
  }

  setAgent(agent: AgentType): void {
    this.currentAgent = agent;
  }

  getMode(): ChatMode {
    return this.currentMode;
  }

  setMode(mode: ChatMode): void {
    this.currentMode = mode;
    this.saveModeToCurrentSession();
  }

  getModel(): string | null {
    return this.currentModel;
  }

  setModel(model: string | null): void {
    this.currentModel = model;
  }

  getIsStreaming(): boolean {
    return this.isStreaming;
  }

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  /** Transfer a CLI session ID to the chat's Claude agent (e.g. from a completed workflow). */
  setClaudeCliSessionId(id: string | null): void {
    this.claudeAgent.setCliSessionId(id);
  }

  // ── Pinned files (010-pinned-files) ──

  getPinnedFiles(): string[] {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    return session?.pinnedFiles ?? [];
  }

  pinFile(filePath: string): string[] {
    let session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) {
      // Session not yet in list (no messages sent yet) — create it now
      session = {
        id: this.activeSessionId,
        title: 'New Chat',
        createdAt: new Date().toISOString(),
        agentType: this.currentAgent,
      };
      this.sessions.unshift(session);
    }
    if (!session.pinnedFiles) session.pinnedFiles = [];
    if (!session.pinnedFiles.includes(filePath)) {
      session.pinnedFiles.push(filePath);
      this.persistSessions();
    }
    return [...session.pinnedFiles];
  }

  unpinFile(filePath: string): string[] {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session?.pinnedFiles) return [];
    session.pinnedFiles = session.pinnedFiles.filter((p) => p !== filePath);
    this.persistSessions();
    return [...session.pinnedFiles];
  }

  // ── Session search (011-session-search) ──

  searchSessions(query: string): ChatSession[] {
    if (!query.trim()) return [...this.sessions];
    const lower = query.toLowerCase();
    return this.sessions.filter((s) => s.title.toLowerCase().includes(lower));
  }

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    this.ensureCurrentSessionInList();
    this.persistMessages();
  }

  removeMessage(id: string): void {
    this.messages = this.messages.filter((m) => m.id !== id);
    this.persistMessages();
  }

  updateMessage(id: string, updates: Partial<ChatMessage>): void {
    const msg = this.messages.find((m) => m.id === id);
    if (msg) {
      Object.assign(msg, updates);
      this.persistMessages();
    }
  }

  /** Create a new session, preserving the current one in the sessions list. */
  createSession(): ChatSession {
    this.cancelActiveChat();

    // Save CLI session ID before switching away
    this.saveCliSessionIdToCurrentSession();

    // Ensure current session is saved in the list if it has messages
    this.ensureCurrentSessionInList();

    // Create new session
    const newId = crypto.randomBytes(8).toString('hex');
    const session: ChatSession = {
      id: newId,
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      agentType: this.currentAgent,
    };

    this.sessions.unshift(session);
    this.activeSessionId = newId;
    this.messages = [];
    this.currentMode = 'ask';
    this.currentModel = null;

    // Reset CLI sessions for fresh context
    this.claudeAgent.resetSession();
    this.codexAgent.resetSession();

    this.persistSessions();
    this.persistMessages();

    return session;
  }

  /** Switch to an existing session. The caller provides the messages for the target session. */
  switchSession(id: string, messages: ChatMessage[]): void {
    if (id === this.activeSessionId) return;

    this.cancelActiveChat();

    // Save current CLI session ID before switching away
    this.saveCliSessionIdToCurrentSession();

    // Save current messages before switching
    this.persistMessages();

    // Switch to the target session
    this.activeSessionId = id;
    this.messages = messages;
    this.currentModel = null;

    // Update the agent and mode to match the session's persisted state
    const targetSession = this.sessions.find((s) => s.id === id);
    if (targetSession) {
      this.currentAgent = targetSession.agentType;
      this.currentMode = targetSession.mode ?? 'ask';
    } else {
      this.currentMode = 'ask';
    }

    // Reset CLI sessions, then restore target session's CLI session ID
    this.claudeAgent.resetSession();
    this.codexAgent.resetSession();
    if (targetSession?.cliSessionId) {
      this.claudeAgent.setCliSessionId(targetSession.cliSessionId);
    }
  }

  /** Delete a session. If it's the active one, switch to the most recent remaining session. */
  deleteSession(id: string): { switchedTo: string | null; messages: ChatMessage[] } {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.persistSessions();
    this.persistFns?.deleteMessages(id);

    if (id === this.activeSessionId) {
      // Switch to the most recent session, or create a fresh one
      if (this.sessions.length > 0) {
        const next = this.sessions[0];
        this.activeSessionId = next.id;
        this.currentAgent = next.agentType;
        this.currentMode = next.mode ?? 'ask';
        this.currentModel = null;
        this.messages = []; // caller should load messages for this session
        this.claudeAgent.resetSession();
        this.codexAgent.resetSession();
        if (next.cliSessionId) {
          this.claudeAgent.setCliSessionId(next.cliSessionId);
        }
        return { switchedTo: next.id, messages: [] };
      } else {
        // No sessions left — create a fresh one
        const fresh = this.createSession();
        return { switchedTo: fresh.id, messages: [] };
      }
    }

    return { switchedTo: null, messages: this.messages };
  }

  /** Rename a session's title. */
  renameSession(id: string, title: string): void {
    const session = this.sessions.find((s) => s.id === id);
    if (session) {
      session.title = title;
      this.persistSessions();
    }
  }

  /** Called by clearHistory/newChat — creates new session. */
  clearHistory(): void {
    this.cancelActiveChat();
    this.saveCliSessionIdToCurrentSession();
    this.ensureCurrentSessionInList();

    const newId = crypto.randomBytes(8).toString('hex');
    const session: ChatSession = {
      id: newId,
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      agentType: this.currentAgent,
    };
    this.sessions.unshift(session);
    this.activeSessionId = newId;
    this.messages = [];
    this.currentMode = 'ask';
    this.currentModel = null;

    // Reset CLI sessions so next chat starts fresh
    this.claudeAgent.resetSession();
    this.codexAgent.resetSession();

    this.persistSessions();
    this.persistMessages();
  }

  async sendMessage(
    text: string,
    workspacePath: string,
    config: PipelineConfig,
    callbacks: ChatCallbacks,
    fileContext?: string,
  ): Promise<void> {
    // Auto-set session title from first user message
    this.autoSetSessionTitle(text);

    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomBytes(8).toString('hex'),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(userMsg);

    // Create assistant message placeholder
    const assistantId = crypto.randomBytes(8).toString('hex');
    const mode = this.currentMode;
    const model = this.currentModel;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      agent: this.currentAgent,
      mode,
      model: model ?? undefined,
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    this.messages.push(assistantMsg);
    this.persistMessages();

    this.isStreaming = true;
    let fullText = '';

    try {
      const onStream = (chunk: string) => {
        fullText += chunk;
        assistantMsg.content = fullText;
        callbacks.onStreamChunk(assistantId, chunk);
      };

      // Prepend file reference context if provided
      const messageForAgent = fileContext ? `${fileContext}\n\n${text}` : text;

      const onUsage = (usage: TokenUsage) => {
        assistantMsg.tokenUsage = usage;
        callbacks.onTokenUsage?.(assistantId, usage);
      };

      if (this.currentAgent === 'claude') {
        // Claude uses --resume to continue its CLI session (tool use, file reads, etc.).
        // Prepend only the other agent's turns so Claude sees cross-agent messages
        // without duplicating its own turns that --resume already provides.
        const crossAgentContext = this.buildCrossAgentContext('codex');
        const messageWithContext = crossAgentContext
          ? `${crossAgentContext}\n\nUser: ${messageForAgent}`
          : messageForAgent;
        const onThinking = callbacks.onThinkingChunk
          ? (chunk: string) => callbacks.onThinkingChunk!(assistantId, chunk)
          : undefined;
        const onQuestions = callbacks.onQuestionsDetected
          ? (questions: ClarificationQuestion[]) => callbacks.onQuestionsDetected!(questions)
          : undefined;
        await this.claudeAgent.chat({
          message: messageWithContext,
          workspacePath,
          config,
          onStream,
          onThinkingStream: onThinking,
          onQuestionsDetected: onQuestions,
          mode,
          modelOverride: model ?? undefined,
          onTokenUsage: onUsage,
        });
      } else {
        // Codex exec is stateless — each invocation is a fresh process with no memory.
        // Prepend full conversation history so it has complete context.
        const fullHistory = this.buildFullHistoryContext();
        const messageWithHistory = fullHistory
          ? `${fullHistory}\n\nUser: ${messageForAgent}`
          : messageForAgent;
        await this.codexAgent.chat({
          message: messageWithHistory,
          workspacePath,
          config,
          onStream,
          mode,
          modelOverride: model ?? undefined,
          onTokenUsage: onUsage,
        });
      }

      // Check for inline clarification questions in the response text
      const { questions: inlineQuestions, cleanedText } = extractInlineClarifications(fullText);
      const finalText = inlineQuestions.length > 0 ? cleanedText : fullText;

      assistantMsg.content = finalText;
      assistantMsg.isStreaming = false;
      this.saveCliSessionIdToCurrentSession();
      this.persistMessages();
      callbacks.onStreamEnd(assistantId, finalText);

      // Fire clarification callback if inline questions were found
      if (inlineQuestions.length > 0 && callbacks.onQuestionsDetected) {
        callbacks.onQuestionsDetected(inlineQuestions);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      assistantMsg.isStreaming = false;
      assistantMsg.content = fullText || `Error: ${errorMessage}`;
      this.persistMessages();
      callbacks.onError(assistantId, errorMessage);
    } finally {
      this.isStreaming = false;
    }
  }

  cancelActiveChat(): void {
    if (this.isStreaming) {
      this.claudeAgent.kill();
      this.codexAgent.kill();
      this.isStreaming = false;
    }
  }

  private autoSetSessionTitle(text: string): void {
    const title = text.length > 40 ? text.slice(0, 40) + '...' : text;
    let session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (!session) {
      // First message in a session not yet registered — create it now
      session = {
        id: this.activeSessionId,
        title,
        createdAt: new Date().toISOString(),
        agentType: this.currentAgent,
      };
      this.sessions.unshift(session);
      this.persistSessions();
      return;
    }
    if (session.title === 'New Chat') {
      session.title = title;
      session.agentType = this.currentAgent;
      this.persistSessions();
    }
  }

  /** Ensure the current session is tracked in the sessions list. */
  private ensureCurrentSessionInList(): void {
    const exists = this.sessions.some((s) => s.id === this.activeSessionId);
    if (!exists && this.messages.length > 0) {
      const firstUserMsg = this.messages.find((m) => m.role === 'user');
      const title = firstUserMsg
        ? firstUserMsg.content.length > 40
          ? firstUserMsg.content.slice(0, 40) + '...'
          : firstUserMsg.content
        : 'New Chat';
      this.sessions.unshift({
        id: this.activeSessionId,
        title,
        createdAt: this.messages[0].timestamp,
        agentType: this.currentAgent,
      });
      this.persistSessions();
      this.persistMessages();
    }
  }

  /** Build full conversation history for agents without session persistence (Codex).
   *  Also used to prepend context when switching to Workflow mode mid-conversation. */
  buildFullHistoryContext(): string {
    const completed = this.messages.filter((m) => !m.isStreaming && m.content);
    // Skip the user message we just added
    const history = completed.slice(0, -1);
    // Keep last 10 messages to avoid token bloat
    const recent = history.slice(-10);
    if (recent.length === 0) return '';

    const lines = recent.map((m) => {
      const role = m.role === 'user' ? 'User' : `Assistant (${m.agent ?? 'unknown'})`;
      const content = m.content.length > 5000 ? m.content.slice(0, 5000) + '...' : m.content;
      return `${role}: ${content}`;
    });

    return `## Conversation History\n${lines.join('\n\n')}`;
  }

  /** Build context containing only the other agent's turns + their preceding user messages. */
  private buildCrossAgentContext(otherAgent: AgentType): string {
    const completed = this.messages.filter((m) => !m.isStreaming && m.content);
    // Skip the user message we just added
    const history = completed.slice(0, -1);

    // Limit to last 10 messages to avoid token bloat, then collect other-agent turns
    const recent = history.slice(-10);
    const relevantLines: string[] = [];
    for (let i = 0; i < recent.length; i++) {
      const msg = recent[i];
      if (msg.role === 'assistant' && msg.agent === otherAgent) {
        // Include the preceding user message for context if it exists
        if (i > 0 && recent[i - 1].role === 'user') {
          const userContent = recent[i - 1].content;
          const truncated = userContent.length > 5000 ? userContent.slice(0, 5000) + '...' : userContent;
          relevantLines.push(`User: ${truncated}`);
        }
        const content = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
        relevantLines.push(`Assistant (${otherAgent}): ${content}`);
      }
    }

    if (relevantLines.length === 0) return '';
    return `## Messages from other agent (${otherAgent})\n${relevantLines.join('\n\n')}`;
  }

  /** Save the current chat mode to the active session entry. */
  private saveModeToCurrentSession(): void {
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (session) {
      session.mode = this.currentMode;
      this.persistSessions();
    }
  }

  /** Save the current Claude CLI session ID to the active session entry. */
  private saveCliSessionIdToCurrentSession(): void {
    const cliId = this.claudeAgent.getCliSessionId();
    if (!cliId) return;
    const session = this.sessions.find((s) => s.id === this.activeSessionId);
    if (session) {
      session.cliSessionId = cliId;
      this.persistSessions();
    }
  }

  private persistMessages(): void {
    this.persistFns?.persistMessages(this.activeSessionId, this.messages);
  }

  private persistSessions(): void {
    this.persistFns?.persistSessions(this.sessions);
  }
}
