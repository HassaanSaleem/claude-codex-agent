import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { GitService } from '../../src/services/gitService.js';
import { runCommand } from '../../src/infra/subprocessRunner.js';

describe('GitService', () => {
  let service: GitService;
  let tmpDir: string;

  beforeEach(async () => {
    service = new GitService();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccx-git-test-'));
    // Initialize a git repo
    await runCommand('git', ['init'], { cwd: tmpDir, timeoutMs: 5000 });
    await runCommand('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, timeoutMs: 5000 });
    await runCommand('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, timeoutMs: 5000 });
    // Create initial commit
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test');
    await runCommand('git', ['add', '-A'], { cwd: tmpDir, timeoutMs: 5000 });
    await runCommand('git', ['commit', '-m', 'initial'], { cwd: tmpDir, timeoutMs: 5000 });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getDiff', () => {
    it('returns diff of uncommitted changes', async () => {
      await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test\nNew line');
      const diff = await service.getDiff(tmpDir);
      expect(diff).toContain('+New line');
    });
  });
});
