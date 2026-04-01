import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { HistoryEntry } from '../domain/types.js';

export class HistoryWriter {
  private filePath: string;

  constructor(specDir: string) {
    this.filePath = path.join(specDir, 'history.jsonl');
  }

  async append(entry: HistoryEntry): Promise<void> {
    try {
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.filePath, line, 'utf-8');
    } catch {
      // History append failure is non-fatal — swallow to prevent
      // unhandled rejections from fire-and-forget callers
    }
  }

  async readAll(): Promise<HistoryEntry[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const entries: HistoryEntry[] = [];
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as HistoryEntry);
        } catch {
          // Skip corrupt JSONL lines instead of discarding all entries
        }
      }
      return entries;
    } catch {
      return [];
    }
  }
}
