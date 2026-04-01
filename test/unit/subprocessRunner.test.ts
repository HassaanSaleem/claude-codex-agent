import { describe, it, expect } from 'vitest';
import { spawnStreaming, runCommand, parseCommand } from '../../src/infra/subprocessRunner.js';

describe('parseCommand', () => {
  it('splits command into executable and args', () => {
    const [cmd, args] = parseCommand('python -m pytest');
    expect(cmd).toBe('python');
    expect(args).toEqual(['-m', 'pytest']);
  });

  it('handles single command with no args', () => {
    const [cmd, args] = parseCommand('echo');
    expect(cmd).toBe('echo');
    expect(args).toEqual([]);
  });

  it('handles extra whitespace', () => {
    const [cmd, args] = parseCommand('  node   --version  ');
    expect(cmd).toBe('node');
    expect(args).toEqual(['--version']);
  });
});

describe('runCommand', () => {
  it('captures stdout from a successful command', async () => {
    const result = await runCommand('echo', ['hello'], {
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('returns non-zero exit code for failing command', async () => {
    const result = await runCommand('node', ['-e', 'process.exit(42)'], {
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    expect(result.exitCode).not.toBe(0);
  });

  it('returns exit code 127 for missing command', async () => {
    const result = await runCommand('nonexistent_command_xyz', [], {
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(127);
  });
});

describe('spawnStreaming', () => {
  it('captures streaming output', async () => {
    const chunks: string[] = [];
    const handle = spawnStreaming('echo', ['streaming test'], {
      cwd: process.cwd(),
      timeoutMs: 5000,
      onStdout: (chunk) => chunks.push(chunk),
    });

    const result = await handle.result;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('streaming test');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('pipes stdin to process', async () => {
    const handle = spawnStreaming('cat', [], {
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdin: 'hello from stdin',
    });

    const result = await handle.result;
    expect(result.stdout).toBe('hello from stdin');
  });

  it('can be killed', async () => {
    const handle = spawnStreaming('sleep', ['10'], {
      cwd: process.cwd(),
      timeoutMs: 30000,
    });

    handle.kill();
    const result = await handle.result;
    expect(result.exitCode).not.toBe(0);
  });
});
