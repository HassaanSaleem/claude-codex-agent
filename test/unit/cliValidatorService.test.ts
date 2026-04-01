import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLIValidatorService } from '../../src/services/cliValidatorService.js';
import type { PipelineConfig, CLIDependency } from '../../src/domain/types.js';
import { DEFAULT_CONFIG, CLI_DEPENDENCIES } from '../../src/domain/constants.js';

// Mock subprocessRunner
vi.mock('../../src/infra/subprocessRunner.js', () => ({
  runCommand: vi.fn(),
}));

import { runCommand } from '../../src/infra/subprocessRunner.js';
const mockRunCommand = vi.mocked(runCommand);

const claudeDep = CLI_DEPENDENCIES.claude;
const codexDep = CLI_DEPENDENCIES.codex;

describe('CLIValidatorService', () => {
  let validator: CLIValidatorService;

  beforeEach(() => {
    vi.resetAllMocks();
    validator = new CLIValidatorService();
  });

  // T005: CLI not found returns found: false, correct install command
  describe('validateCli — CLI not found', () => {
    it('returns found: false, correct install command, and descriptive error', async () => {
      mockRunCommand.mockResolvedValue({
        stdout: '',
        stderr: 'ENOENT',
        exitCode: 127,
        timedOut: false,
      });

      const result = await validator.validateCli('claude', claudeDep);
      expect(result.found).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.versionValid).toBe(false);
      expect(result.installCommand).toBe(claudeDep.installCommand);
      expect(result.error).toContain('not found');
      expect(result.error).toContain(claudeDep.installCommand);
    });
  });

  // T006: CLI found but version unparseable
  describe('validateCli — unparseable version', () => {
    it('returns versionValid: false with explanation of expected vs received', async () => {
      mockRunCommand.mockResolvedValue({
        stdout: 'beta-2024.1-rc',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const result = await validator.validateCli('claude', claudeDep);
      expect(result.found).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.versionValid).toBe(false);
      expect(result.version).toBeNull();
      expect(result.error).toContain('semantic version');
      expect(result.error).toContain('expected X.Y.Z');
      expect(result.error).toContain('beta-2024.1-rc');
    });
  });

  // T007: CLI version below minimum
  describe('validateCli — version below minimum', () => {
    it('returns versionValid: false, shows current vs required version', async () => {
      // --version call
      mockRunCommand.mockResolvedValueOnce({
        stdout: 'claude-code 0.9.0',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });
      // --help call for probeFeatures
      mockRunCommand.mockResolvedValueOnce({
        stdout: claudeDep.requiredFlags.join(' '),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const result = await validator.validateCli('claude', claudeDep);
      expect(result.found).toBe(true);
      expect(result.versionValid).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.version).toBe('0.9.0');
      expect(result.error).toContain('0.9.0');
      expect(result.error).toContain('below minimum');
      expect(result.error).toContain(claudeDep.upgradeCommand);
    });
  });

  // T008: CLI version meets minimum
  describe('validateCli — version meets minimum', () => {
    it('returns versionValid: true when version equals minimum', async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: `claude-code ${claudeDep.minVersion}`,
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });
      mockRunCommand.mockResolvedValueOnce({
        stdout: claudeDep.requiredFlags.join(' '),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const result = await validator.validateCli('claude', claudeDep);
      expect(result.found).toBe(true);
      expect(result.versionValid).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('returns versionValid: true when version exceeds minimum', async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: 'claude-code 5.0.0',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });
      mockRunCommand.mockResolvedValueOnce({
        stdout: claudeDep.requiredFlags.join(' '),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const result = await validator.validateCli('claude', claudeDep);
      expect(result.versionValid).toBe(true);
      expect(result.valid).toBe(true);
    });
  });

  // T009: probeFeatures detects missing flags
  describe('probeFeatures — missing flags', () => {
    it('detects missing flags from --help output', async () => {
      mockRunCommand.mockResolvedValue({
        stdout: '--print --verbose',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const result = await validator.probeFeatures('claude', ['--print', '--verbose', '--output-format', '--allowedTools']);
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['--output-format', '--allowedTools']);
    });
  });

  // T010: probeFeatures all flags present
  describe('probeFeatures — all flags present', () => {
    it('returns valid: true when all flags found in help output', async () => {
      mockRunCommand.mockResolvedValue({
        stdout: '--print --verbose --output-format --include-partial-messages --append-system-prompt --allowedTools',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const result = await validator.probeFeatures('claude', claudeDep.requiredFlags);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  // T011: validateAll with mixed results
  describe('validateAll — mixed results', () => {
    it('returns CLIStatus ready: false when one CLI is valid and one is outdated', async () => {
      // Use argument-based mock to handle Promise.all interleaving
      mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'claude' && args[0] === '--version') {
          return { stdout: 'claude-code 2.0.0', stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'claude' && args[0] === '--help') {
          return { stdout: claudeDep.requiredFlags.join(' '), stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'codex' && args[0] === '--version') {
          return { stdout: 'codex 0.0.1', stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'codex' && args[0] === 'exec') {
          return { stdout: codexDep.requiredFlags.join(' '), stderr: '', exitCode: 0, timedOut: false };
        }
        return { stdout: '', stderr: '', exitCode: 1, timedOut: false };
      });

      const config: PipelineConfig = { ...DEFAULT_CONFIG };
      const status = await validator.validateAll(config);

      expect(status.ready).toBe(false);
      expect(status.claude.valid).toBe(true);
      expect(status.claude.error).toBeNull();
      expect(status.codex.valid).toBe(false);
      expect(status.codex.error).toContain('below minimum');
      expect(status.lastChecked).toBeGreaterThan(0);
    });
  });

  // T012: validateCli timeout handling
  describe('validateCli — timeout', () => {
    it('handles timeout gracefully with timeout-specific error message', async () => {
      mockRunCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 124,
        timedOut: true,
      });

      const result = await validator.validateCli('claude', claudeDep);
      expect(result.found).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.error).toContain('installed and responsive');
    });
  });

  // Existing tests — backward compatibility
  describe('validateCli — backward compat', () => {
    it('returns valid when CLI version is above minimum', async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: 'claude-code 1.5.0',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });
      mockRunCommand.mockResolvedValueOnce({
        stdout: claudeDep.requiredFlags.join(' '),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });

      const result = await validator.validateCli('claude', claudeDep);
      expect(result.found).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.version).toBe('1.5.0');
      expect(result.error).toBeNull();
    });
  });

  // T020: Notification message format
  describe('notification message format', () => {
    it('CLIStatus with ready: false produces error containing CLI name per contract', async () => {
      mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'claude' && args[0] === '--version') {
          return { stdout: 'claude-code 0.5.0', stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'claude' && args[0] === '--help') {
          return { stdout: claudeDep.requiredFlags.join(' '), stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'codex' && args[0] === '--version') {
          return { stdout: 'codex 1.0.0', stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'codex' && args[0] === 'exec') {
          return { stdout: codexDep.requiredFlags.join(' '), stderr: '', exitCode: 0, timedOut: false };
        }
        return { stdout: '', stderr: '', exitCode: 1, timedOut: false };
      });

      const config: PipelineConfig = { ...DEFAULT_CONFIG };
      const status = await validator.validateAll(config);

      expect(status.ready).toBe(false);
      // The failing CLI's error message should follow the contract pattern
      const failedCli = [status.claude, status.codex].find((r) => !r.valid)!;
      expect(failedCli).toBeDefined();
      expect(failedCli.error).toBeTruthy();
      // Error should contain version info and upgrade command
      expect(failedCli.error).toContain('0.5.0');
      expect(failedCli.error).toContain('below minimum');
      expect(failedCli.error).toContain(claudeDep.upgradeCommand);
    });
  });

  describe('validateAll', () => {
    it('returns CLIStatus with ready: true when both CLIs valid', async () => {
      // Use argument-based mock to handle Promise.all interleaving
      // Note: Claude help uses ['--help'], Codex help uses ['exec', '--help']
      mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'claude' && args[0] === '--version') {
          return { stdout: 'claude-code 2.0.0', stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'claude' && args[0] === '--help') {
          return { stdout: claudeDep.requiredFlags.join(' '), stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'codex' && args[0] === '--version') {
          return { stdout: 'codex 1.0.0', stderr: '', exitCode: 0, timedOut: false };
        }
        if (cmd === 'codex' && args[0] === 'exec') {
          return { stdout: codexDep.requiredFlags.join(' '), stderr: '', exitCode: 0, timedOut: false };
        }
        return { stdout: '', stderr: '', exitCode: 1, timedOut: false };
      });

      const config: PipelineConfig = { ...DEFAULT_CONFIG };
      const status = await validator.validateAll(config);

      expect(status.ready).toBe(true);
      expect(status.claude.cli).toBe('claude');
      expect(status.claude.found).toBe(true);
      expect(status.codex.cli).toBe('codex');
      expect(status.codex.found).toBe(true);
      expect(status.lastChecked).toBeGreaterThan(0);
    });
  });
});
