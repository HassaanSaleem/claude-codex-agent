import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileAutocompleteEntry, FileReference } from '../domain/types.js';
import type { IFileReferenceService } from '../domain/interfaces.js';
import { EXCLUDED_DIRS, MAX_FILE_SIZE } from '../domain/constants.js';
import { isBinaryFile, isSensitiveFile, fuzzyMatch } from '../utils/filePatterns.js';

export class FileReferenceService implements IFileReferenceService {
  private fileCache: FileAutocompleteEntry[] | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Invalidate cache on file system changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      watcher.onDidCreate(() => { this.fileCache = null; }),
      watcher.onDidDelete(() => { this.fileCache = null; }),
      watcher,
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  async listFiles(workspacePath: string, query: string, limit: number = 50): Promise<FileAutocompleteEntry[]> {
    if (!this.fileCache) {
      const uris = await vscode.workspace.findFiles('**/*', EXCLUDED_DIRS);
      const workspaceUri = vscode.Uri.file(workspacePath);

      this.fileCache = uris.map((uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        return {
          relativePath,
          fileName: path.basename(relativePath),
          dirPath: path.dirname(relativePath),
        };
      }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    }

    if (!query) {
      return this.fileCache.slice(0, limit);
    }

    const scored = this.fileCache
      .map((entry) => ({ entry, score: fuzzyMatch(query, entry.relativePath) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((item) => item.entry);
  }

  async resolveFileReferences(
    workspacePath: string,
    paths: string[],
  ): Promise<{ references: FileReference[]; formattedContext: string }> {
    // Deduplicate
    const uniquePaths = [...new Set(paths)];
    const references: FileReference[] = [];
    const contentBlocks: string[] = [];

    for (const filePath of uniquePaths) {
      // Path traversal check
      const normalized = path.normalize(filePath);
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        references.push({
          path: filePath,
          status: 'missing',
          isSensitive: false,
          size: null,
          truncatedAt: null,
        });
        continue;
      }

      const sensitive = isSensitiveFile(filePath);

      // Binary check
      if (isBinaryFile(filePath)) {
        references.push({
          path: filePath,
          status: 'binary',
          isSensitive: sensitive,
          size: null,
          truncatedAt: null,
        });
        continue;
      }

      const absolutePath = path.join(workspacePath, normalized);

      try {
        const stat = await fs.stat(absolutePath);
        const fileSize = stat.size;
        let content: string;
        let truncatedAt: number | null = null;
        let status: FileReference['status'] = 'resolved';

        if (fileSize > MAX_FILE_SIZE) {
          const buffer = Buffer.alloc(MAX_FILE_SIZE);
          const fh = await fs.open(absolutePath, 'r');
          try {
            await fh.read(buffer, 0, MAX_FILE_SIZE, 0);
          } finally {
            await fh.close();
          }
          content = buffer.toString('utf-8');
          truncatedAt = MAX_FILE_SIZE;
          status = 'truncated';
        } else {
          content = await fs.readFile(absolutePath, 'utf-8');
        }

        references.push({
          path: filePath,
          status,
          isSensitive: sensitive,
          size: fileSize,
          truncatedAt,
        });

        contentBlocks.push('```' + filePath + '\n' + content + '\n```');
      } catch {
        references.push({
          path: filePath,
          status: 'missing',
          isSensitive: sensitive,
          size: null,
          truncatedAt: null,
        });
      }
    }

    const formattedContext = contentBlocks.length > 0
      ? '## Referenced Files (starting point — explore related files too)\n\n' + contentBlocks.join('\n\n')
      : '';

    return { references, formattedContext };
  }
}
