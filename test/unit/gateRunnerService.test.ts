import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GateRunnerService } from '../../src/services/gateRunnerService.js';
import type { PipelineConfig } from '../../src/domain/types.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';
import * as subprocessRunner from '../../src/infra/subprocessRunner.js';

vi.mock('../../src/infra/subprocessRunner.js', () => ({
  parseCommand: vi.fn((cmd: string) => {
    const parts = cmd.trim().split(/\s+/);
    return [parts[0], parts.slice(1)];
  }),
  runCommand: vi.fn(),
}));

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function mockCommandResult(exitCode = 0, stdout = 'ok', stderr = '', timedOut = false) {
  return { exitCode, stdout, stderr, timedOut };
}

describe('GateRunnerService', () => {
  let service: GateRunnerService;

  beforeEach(() => {
    service = new GateRunnerService();
    vi.clearAllMocks();
  });

  it('runs all configured gates', async () => {
    vi.mocked(subprocessRunner.runCommand).mockResolvedValue(mockCommandResult());

    const config = makeConfig({
      testCommand: 'npm test',
      lintCommand: 'eslint .',
      typecheckCommand: 'tsc --noEmit',
      securityScanCommand: 'audit-ci',
    });

    const results = await service.runGates(config, '/workspace');

    expect(results).toHaveLength(4);
    expect(results.map((r) => r.toolName)).toEqual(['test', 'lint', 'typecheck', 'security']);
  });

  it('skips gates with empty commands', async () => {
    vi.mocked(subprocessRunner.runCommand).mockResolvedValue(mockCommandResult());

    const config = makeConfig({
      testCommand: 'npm test',
      lintCommand: '',
      typecheckCommand: 'tsc --noEmit',
      securityScanCommand: '',
    });

    const results = await service.runGates(config, '/workspace');

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.toolName)).toEqual(['test', 'typecheck']);
  });

  it('reports pass when exit code is 0', async () => {
    vi.mocked(subprocessRunner.runCommand).mockResolvedValue(mockCommandResult(0, 'All tests passed'));

    const config = makeConfig({
      testCommand: 'pytest',
      lintCommand: '',
      typecheckCommand: '',
      securityScanCommand: '',
    });

    const results = await service.runGates(config, '/workspace');

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].exitCode).toBe(0);
    expect(results[0].stdout).toBe('All tests passed');
  });

  it('reports failure when exit code is non-zero', async () => {
    vi.mocked(subprocessRunner.runCommand).mockResolvedValue(
      mockCommandResult(1, '', 'Lint errors found', false),
    );

    const config = makeConfig({
      testCommand: '',
      lintCommand: 'ruff check .',
      typecheckCommand: '',
      securityScanCommand: '',
    });

    const results = await service.runGates(config, '/workspace');

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].exitCode).toBe(1);
    expect(results[0].stderr).toBe('Lint errors found');
  });

  it('reports timeout when command exceeds limit', async () => {
    vi.mocked(subprocessRunner.runCommand).mockResolvedValue(
      mockCommandResult(1, '', 'killed', true),
    );

    const config = makeConfig({
      testCommand: 'pytest --slow',
      lintCommand: '',
      typecheckCommand: '',
      securityScanCommand: '',
      gateTimeoutSeconds: 30,
    });

    const results = await service.runGates(config, '/workspace');

    expect(results[0].timeoutExceeded).toBe(true);
  });

  it('uses correct timeout from config', async () => {
    vi.mocked(subprocessRunner.runCommand).mockResolvedValue(mockCommandResult());

    const config = makeConfig({
      testCommand: 'npm test',
      lintCommand: '',
      typecheckCommand: '',
      securityScanCommand: '',
      gateTimeoutSeconds: 120,
    });

    await service.runGates(config, '/workspace');

    expect(subprocessRunner.runCommand).toHaveBeenCalledWith(
      'npm',
      ['test'],
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
  });

  it('captures command string in result', async () => {
    vi.mocked(subprocessRunner.runCommand).mockResolvedValue(mockCommandResult());

    const config = makeConfig({
      testCommand: 'python -m pytest -v',
      lintCommand: '',
      typecheckCommand: '',
      securityScanCommand: '',
    });

    const results = await service.runGates(config, '/workspace');

    expect(results[0].command).toBe('python -m pytest -v');
  });

  it('measures duration for each gate', async () => {
    vi.mocked(subprocessRunner.runCommand).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockCommandResult()), 50)),
    );

    const config = makeConfig({
      testCommand: 'npm test',
      lintCommand: '',
      typecheckCommand: '',
      securityScanCommand: '',
    });

    const results = await service.runGates(config, '/workspace');

    expect(results[0].durationSeconds).toBeGreaterThan(0);
  });
});
