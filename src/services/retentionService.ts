import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IRetentionService } from '../domain/interfaces.js';

export class RetentionService implements IRetentionService {
  async enforceRetention(workspacePath: string, runDirectory: string, limit: number): Promise<void> {
    if (limit <= 0) return;
    const specsDir = path.join(workspacePath, runDirectory);

    try {
      const entries = await fs.readdir(specsDir, { withFileTypes: true });
      // Only consider feature directories (NNN-slug pattern); skip non-feature dirs like chat_sessions
      const dirs = entries.filter((e) => e.isDirectory() && /^\d+-/.test(e.name)).map((e) => e.name);

      if (dirs.length <= limit) {
        return;
      }

      // Sort by directory mtime (most recent last) so we keep the newest specs
      const withMtime = await Promise.all(
        dirs.map(async (name) => {
          try {
            const stat = await fs.stat(path.join(specsDir, name));
            return { name, mtime: stat.mtimeMs };
          } catch {
            return { name, mtime: 0 };
          }
        }),
      );
      withMtime.sort((a, b) => a.mtime - b.mtime);

      const toDelete = withMtime.slice(0, withMtime.length - limit);

      for (const { name } of toDelete) {
        try {
          await fs.rm(path.join(specsDir, name), { recursive: true, force: true });
        } catch {
          // Retention failure must never propagate — log-only in production
        }
      }
    } catch {
      // specs directory may not exist yet — silently ignore
    }
  }
}
