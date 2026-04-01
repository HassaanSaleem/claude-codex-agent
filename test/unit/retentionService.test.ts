import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { RetentionService } from '../../src/services/retentionService.js';

describe('RetentionService', () => {
  let service: RetentionService;
  let tmpDir: string;

  beforeEach(async () => {
    service = new RetentionService();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-test-'));
    // Create a runs/ subdirectory
    await fs.mkdir(path.join(tmpDir, 'specs'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createRunDirs(count: number): Promise<string[]> {
    const dirs: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = `${String(i).padStart(3, '0')}-feature-${String(i).padStart(3, '0')}`;
      const dirPath = path.join(tmpDir, 'specs', name);
      await fs.mkdir(dirPath, { recursive: true });
      dirs.push(name);
    }
    return dirs;
  }

  it('deletes oldest directories when count exceeds limit', async () => {
    await createRunDirs(22);
    await service.enforceRetention(tmpDir, 'specs', 20);

    const remaining = await fs.readdir(path.join(tmpDir, 'specs'));
    expect(remaining).toHaveLength(20);
    // Oldest two should be gone
    expect(remaining).not.toContain('000-feature-000');
    expect(remaining).not.toContain('001-feature-001');
  });

  it('does nothing when count is within limit', async () => {
    await createRunDirs(15);
    await service.enforceRetention(tmpDir, 'specs', 20);

    const remaining = await fs.readdir(path.join(tmpDir, 'specs'));
    expect(remaining).toHaveLength(15);
  });

  it('handles empty directory without error', async () => {
    await expect(service.enforceRetention(tmpDir, 'specs', 20)).resolves.not.toThrow();
  });

  it('ignores non-directory entries', async () => {
    await createRunDirs(3);
    // Add a file that should be ignored
    await fs.writeFile(path.join(tmpDir, 'specs', 'README.md'), 'test');
    await service.enforceRetention(tmpDir, 'specs', 2);

    const remaining = await fs.readdir(path.join(tmpDir, 'specs'));
    // 2 dirs + 1 file = 3
    expect(remaining).toContain('README.md');
    const dirs = remaining.filter((f) => f !== 'README.md');
    expect(dirs).toHaveLength(2);
  });

  it('never throws even if deletion fails', async () => {
    // Non-existent run directory — should not throw
    await expect(service.enforceRetention(tmpDir, 'nonexistent', 20)).resolves.not.toThrow();
  });

  it('sorts directories by name for correct chronological order', async () => {
    await createRunDirs(5);
    await service.enforceRetention(tmpDir, 'specs', 3);

    const remaining = (await fs.readdir(path.join(tmpDir, 'specs'))).sort();
    // Should keep the 3 newest (index 2, 3, 4)
    expect(remaining[0]).toBe('002-feature-002');
    expect(remaining[2]).toBe('004-feature-004');
  });
});
