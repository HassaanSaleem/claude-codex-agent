import type { IGitService } from '../domain/interfaces.js';
import { runCommand } from '../infra/subprocessRunner.js';

export class GitService implements IGitService {
  async getDiff(workspacePath: string): Promise<string> {
    // Get both staged and unstaged changes
    const result = await runCommand('git', ['diff', 'HEAD'], {
      cwd: workspacePath,
      timeoutMs: 30_000,
    });
    return result.stdout;
  }
}
