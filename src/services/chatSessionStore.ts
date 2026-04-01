import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatSession, ChatMessage } from '../domain/types.js';

/**
 * Disk-based chat session storage.
 *
 * Layout inside the workspace:
 *   <runDirectory>/chat_sessions/
 *     sessions.json               — ChatSession[] manifest
 *     <sessionId>/
 *       messages.json             — ChatMessage[] for that session
 */
export class ChatSessionStore {
  private baseDir: string;

  constructor(workspacePath: string, runDirectory: string) {
    this.baseDir = path.join(workspacePath, runDirectory, 'chat_sessions');
  }

  // ── Sessions manifest ──────────────────────────────────────────────

  async readSessions(): Promise<ChatSession[]> {
    try {
      const raw = await fs.readFile(path.join(this.baseDir, 'sessions.json'), 'utf-8');
      return JSON.parse(raw) as ChatSession[];
    } catch {
      return [];
    }
  }

  async writeSessions(sessions: ChatSession[]): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(
      path.join(this.baseDir, 'sessions.json'),
      JSON.stringify(sessions, null, 2),
      'utf-8',
    );
  }

  // ── Per-session messages ───────────────────────────────────────────

  async readMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      const raw = await fs.readFile(
        path.join(this.baseDir, sessionId, 'messages.json'),
        'utf-8',
      );
      return JSON.parse(raw) as ChatMessage[];
    } catch {
      return [];
    }
  }

  async writeMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const dir = path.join(this.baseDir, sessionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'messages.json'),
      JSON.stringify(messages, null, 2),
      'utf-8',
    );
  }

  async deleteSessionDir(sessionId: string): Promise<void> {
    const dir = path.join(this.baseDir, sessionId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore — directory may not exist
    }
  }
}
