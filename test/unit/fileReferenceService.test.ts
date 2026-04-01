import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  open: vi.fn(),
}));

import * as fs from 'node:fs/promises';
import { FileReferenceService } from '../../src/services/fileReferenceService.js';

const WORKSPACE = '/mock/workspace';

function makeUri(relativePath: string) {
  return { fsPath: `${WORKSPACE}/${relativePath}`, scheme: 'file' };
}

beforeEach(() => {
  vi.restoreAllMocks();

  // Default: findFiles returns a few mock files
  vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([
    makeUri('src/index.ts'),
    makeUri('src/utils/helper.ts'),
    makeUri('README.md'),
  ] as any);

  // asRelativePath strips workspace prefix
  vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation((uri: any) => {
    const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
    return fsPath.replace(`${WORKSPACE}/`, '');
  });
});

describe('FileReferenceService.resolveFileReferences', () => {
  it('resolves two valid files with formatted context', async () => {
    const service = new FileReferenceService();

    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      if (filePath.includes('index.ts')) return 'const x = 1;';
      return 'export const y = 2;';
    });

    const result = await service.resolveFileReferences(WORKSPACE, [
      'src/index.ts',
      'src/utils/helper.ts',
    ]);

    expect(result.references).toHaveLength(2);
    expect(result.references[0]).toMatchObject({ path: 'src/index.ts', status: 'resolved' });
    expect(result.references[1]).toMatchObject({ path: 'src/utils/helper.ts', status: 'resolved' });
    expect(result.formattedContext).toContain('```src/index.ts');
    expect(result.formattedContext).toContain('```src/utils/helper.ts');
    expect(result.formattedContext).toContain('const x = 1;');
    expect(result.formattedContext).toContain('export const y = 2;');
  });

  it('marks missing file as missing and excludes from context', async () => {
    const service = new FileReferenceService();

    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    const result = await service.resolveFileReferences(WORKSPACE, ['nonexistent.ts']);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({ path: 'nonexistent.ts', status: 'missing' });
    expect(result.formattedContext).toBe('');
  });

  it('marks binary .png as binary and excludes from context', async () => {
    const service = new FileReferenceService();

    const result = await service.resolveFileReferences(WORKSPACE, ['icon.png']);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({ path: 'icon.png', status: 'binary' });
    expect(result.formattedContext).toBe('');
    // Should not call fs.stat for binary files
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it('truncates file over 100KB and marks as truncated', async () => {
    const service = new FileReferenceService();
    const largeSize = 200_000;

    vi.mocked(fs.stat).mockResolvedValue({ size: largeSize } as any);

    const mockFileHandle = {
      read: vi.fn().mockResolvedValue({ bytesRead: 102_400 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(fs.open).mockResolvedValue(mockFileHandle as any);

    const result = await service.resolveFileReferences(WORKSPACE, ['big-file.ts']);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      path: 'big-file.ts',
      status: 'truncated',
      size: largeSize,
      truncatedAt: 102_400,
    });
    expect(result.formattedContext).toContain('```big-file.ts');
    expect(fs.open).toHaveBeenCalled();
    expect(mockFileHandle.close).toHaveBeenCalled();
  });

  it('marks sensitive .env file with isSensitive true', async () => {
    const service = new FileReferenceService();

    vi.mocked(fs.stat).mockResolvedValue({ size: 50 } as any);
    vi.mocked(fs.readFile).mockResolvedValue('SECRET_KEY=abc');

    const result = await service.resolveFileReferences(WORKSPACE, ['.env']);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      path: '.env',
      status: 'resolved',
      isSensitive: true,
    });
    // Sensitive files are still included in context (non-blocking warning)
    expect(result.formattedContext).toContain('SECRET_KEY=abc');
  });

  it('deduplicates paths', async () => {
    const service = new FileReferenceService();

    vi.mocked(fs.stat).mockResolvedValue({ size: 10 } as any);
    vi.mocked(fs.readFile).mockResolvedValue('content');

    const result = await service.resolveFileReferences(WORKSPACE, [
      'src/index.ts',
      'src/index.ts',
      'src/index.ts',
    ]);

    expect(result.references).toHaveLength(1);
    expect(result.references[0].path).toBe('src/index.ts');
  });

  it('rejects path traversal as missing', async () => {
    const service = new FileReferenceService();

    const result = await service.resolveFileReferences(WORKSPACE, ['../../etc/passwd']);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      path: '../../etc/passwd',
      status: 'missing',
    });
    expect(result.formattedContext).toBe('');
    expect(fs.stat).not.toHaveBeenCalled();
  });
});

describe('FileReferenceService.listFiles', () => {
  it('returns alphabetically sorted results for empty query', async () => {
    const service = new FileReferenceService();

    const results = await service.listFiles(WORKSPACE, '');

    expect(results.length).toBe(3);
    // Should be sorted alphabetically
    expect(results[0].relativePath).toBe('README.md');
    expect(results[1].relativePath).toBe('src/index.ts');
    expect(results[2].relativePath).toBe('src/utils/helper.ts');
  });

  it('returns fuzzy-matched results for query', async () => {
    const service = new FileReferenceService();

    const results = await service.listFiles(WORKSPACE, 'helper');

    expect(results.length).toBeGreaterThan(0);
    // helper.ts should be the top result since query matches filename
    expect(results[0].fileName).toBe('helper.ts');
  });
});
