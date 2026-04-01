import type { CLIDependency, CLIValidationResult, CLIStatus, PipelineConfig } from '../domain/types.js';
import type { ICLIValidator } from '../domain/interfaces.js';
import { CLI_DEPENDENCIES } from '../domain/constants.js';
import { runCommand } from '../infra/subprocessRunner.js';

const SEMVER_REGEX = /(\d+\.\d+\.\d+)/;

/**
 * Compare two semver strings. Returns true if version >= minimum.
 */
function compareSemver(version: string, minimum: string): boolean {
  const [aMajor, aMinor, aPatch] = version.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = minimum.split('.').map(Number);
  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch >= bPatch;
}

/**
 * Validates CLI tool availability, version, and feature compatibility.
 * Uses subprocessRunner.runCommand (execFile-based, no shell injection risk).
 */
export class CLIValidatorService implements ICLIValidator {

  /**
   * Probe CLI help output for required flags.
   * Returns { valid, missing } where missing lists flags not found in --help output.
   */
  async probeFeatures(cliPath: string, requiredFlags: string[], helpArgs: string[] = ['--help']): Promise<{ valid: boolean; missing: string[] }> {
    const result = await runCommand(cliPath, helpArgs, {
      cwd: '.',
      timeoutMs: 5_000,
    });

    if (result.timedOut) {
      return { valid: false, missing: requiredFlags };
    }

    const helpOutput = result.stdout + result.stderr;
    const missing = requiredFlags.filter((flag) => !helpOutput.includes(flag));
    return { valid: missing.length === 0, missing };
  }

  async validateCli(cliPath: string, dependency: CLIDependency): Promise<CLIValidationResult> {
    const { cli, minVersion, installCommand } = dependency;

    // Step 1: Check if CLI exists and get version
    const result = await runCommand(cliPath, ['--version'], {
      cwd: '.',
      timeoutMs: 5_000,
    });

    if (result.timedOut) {
      return {
        cli,
        found: false,
        version: null,
        minVersion,
        valid: false,
        versionValid: false,
        featuresValid: false,
        missingFeatures: [],
        error: `CLI at '${cliPath}' timed out during version check. Ensure it is installed and responsive.`,
        installCommand,
      };
    }

    if (result.exitCode === 127) {
      return {
        cli,
        found: false,
        version: null,
        minVersion,
        valid: false,
        versionValid: false,
        featuresValid: false,
        missingFeatures: [],
        error: `CLI not found at '${cliPath}'. Install: ${installCommand}`,
        installCommand,
      };
    }

    const output = result.stdout + result.stderr;
    const match = SEMVER_REGEX.exec(output);

    if (!match) {
      return {
        cli,
        found: true,
        version: null,
        minVersion,
        valid: false,
        versionValid: false,
        featuresValid: false,
        missingFeatures: [],
        error: `Could not parse semantic version (expected X.Y.Z) from '${cliPath} --version' output: ${output.slice(0, 200)}`,
        installCommand,
      };
    }

    const version = match[1];
    const versionValid = compareSemver(version, minVersion);

    // Step 2: Probe feature compatibility
    const featureResult = await this.probeFeatures(cliPath, dependency.requiredFlags, dependency.helpArgs);

    const valid = versionValid && featureResult.valid;

    // Compose error message covering all failure reasons
    const errors: string[] = [];
    if (!versionValid) {
      errors.push(`Version ${version} is below minimum required ${minVersion}. Upgrade: ${dependency.upgradeCommand}`);
    }
    if (!featureResult.valid) {
      errors.push(`Missing required features: ${featureResult.missing.join(', ')}`);
    }

    return {
      cli,
      found: true,
      version,
      minVersion,
      valid,
      versionValid,
      featuresValid: featureResult.valid,
      missingFeatures: featureResult.missing,
      error: errors.length > 0 ? errors.join('. ') : null,
      installCommand,
    };
  }

  async validateAll(config: PipelineConfig): Promise<CLIStatus> {
    const [claude, codex] = await Promise.all([
      this.validateCli(config.claudeCliPath, CLI_DEPENDENCIES.claude),
      this.validateCli(config.codexCliPath, CLI_DEPENDENCIES.codex),
    ]);

    return {
      ready: claude.valid && codex.valid,
      claude,
      codex,
      lastChecked: Date.now(),
    };
  }
}
