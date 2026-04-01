import { describe, it, expect } from 'vitest';
import { isBinaryFile, isSensitiveFile, fuzzyMatch } from '../../src/utils/filePatterns.js';

describe('isBinaryFile', () => {
  it('returns true for image files', () => {
    expect(isBinaryFile('icon.png')).toBe(true);
    expect(isBinaryFile('photo.jpg')).toBe(true);
    expect(isBinaryFile('image.jpeg')).toBe(true);
  });

  it('returns true for compiled files', () => {
    expect(isBinaryFile('app.exe')).toBe(true);
    expect(isBinaryFile('lib.dll')).toBe(true);
    expect(isBinaryFile('module.wasm')).toBe(true);
  });

  it('returns false for text files', () => {
    expect(isBinaryFile('index.ts')).toBe(false);
    expect(isBinaryFile('readme.md')).toBe(false);
    expect(isBinaryFile('config.json')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isBinaryFile('photo.PNG')).toBe(true);
    expect(isBinaryFile('photo.Jpg')).toBe(true);
  });
});

describe('isSensitiveFile', () => {
  it('matches exact .env', () => {
    expect(isSensitiveFile('.env')).toBe(true);
  });

  it('matches .env.* glob pattern', () => {
    expect(isSensitiveFile('.env.local')).toBe(true);
    expect(isSensitiveFile('.env.production')).toBe(true);
  });

  it('matches credentials.json', () => {
    expect(isSensitiveFile('credentials.json')).toBe(true);
  });

  it('matches id_rsa', () => {
    expect(isSensitiveFile('id_rsa')).toBe(true);
    expect(isSensitiveFile('id_ed25519')).toBe(true);
  });

  it('matches *.pem and *.key globs', () => {
    expect(isSensitiveFile('server.pem')).toBe(true);
    expect(isSensitiveFile('private.key')).toBe(true);
  });

  it('matches *secret* glob', () => {
    expect(isSensitiveFile('my-secret-config.yaml')).toBe(true);
    expect(isSensitiveFile('secrets.json')).toBe(true);
  });

  it('returns false for non-sensitive files', () => {
    expect(isSensitiveFile('config.ts')).toBe(false);
    expect(isSensitiveFile('package.json')).toBe(false);
    expect(isSensitiveFile('index.html')).toBe(false);
  });

  it('uses basename only, not full path', () => {
    expect(isSensitiveFile('src/config/.env')).toBe(true);
    expect(isSensitiveFile('deep/path/credentials.json')).toBe(true);
  });
});

describe('fuzzyMatch', () => {
  it('returns 0 for no match', () => {
    expect(fuzzyMatch('xyz', 'src/domain/types.ts')).toBe(0);
  });

  it('returns positive score for substring match', () => {
    expect(fuzzyMatch('types', 'src/domain/types.ts')).toBeGreaterThan(0);
  });

  it('scores exact filename match highest', () => {
    const exact = fuzzyMatch('types.ts', 'src/domain/types.ts');
    const partial = fuzzyMatch('types', 'src/domain/types.ts');
    expect(exact).toBeGreaterThan(partial);
  });

  it('scores filename-starts-with higher than path-contains', () => {
    const startsWithFileName = fuzzyMatch('pipe', 'src/services/pipelineOrchestrator.ts');
    const pathOnly = fuzzyMatch('serv', 'src/services/pipelineOrchestrator.ts');
    expect(startsWithFileName).toBeGreaterThan(pathOnly);
  });

  it('returns base score for empty query', () => {
    expect(fuzzyMatch('', 'any/file.ts')).toBe(1);
  });

  it('matches characters in sequence across the path', () => {
    expect(fuzzyMatch('dt', 'src/domain/types.ts')).toBeGreaterThan(0);
  });
});
