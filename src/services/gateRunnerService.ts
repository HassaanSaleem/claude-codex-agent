import type { PipelineConfig, GateResult } from '../domain/types.js';
import type { IGateRunner } from '../domain/interfaces.js';
import { parseCommand, runCommand } from '../infra/subprocessRunner.js';

interface GateDefinition {
  name: string;
  commandSetting: keyof Pick<PipelineConfig, 'testCommand' | 'lintCommand' | 'typecheckCommand' | 'securityScanCommand'>;
}

const GATES: GateDefinition[] = [
  { name: 'test', commandSetting: 'testCommand' },
  { name: 'lint', commandSetting: 'lintCommand' },
  { name: 'typecheck', commandSetting: 'typecheckCommand' },
  { name: 'security', commandSetting: 'securityScanCommand' },
];

export class GateRunnerService implements IGateRunner {
  async runGates(config: PipelineConfig, workspacePath: string): Promise<GateResult[]> {
    const results: GateResult[] = [];

    for (const gate of GATES) {
      const commandStr = config[gate.commandSetting];
      if (!commandStr) continue;

      const startTime = Date.now();
      const [cmd, args] = parseCommand(commandStr);

      const result = await runCommand(cmd, args, {
        cwd: workspacePath,
        timeoutMs: config.gateTimeoutSeconds * 1000,
      });

      const durationSeconds = (Date.now() - startTime) / 1000;

      results.push({
        toolName: gate.name,
        command: commandStr,
        exitCode: result.exitCode,
        passed: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        durationSeconds,
        timeoutExceeded: result.timedOut,
      });
    }

    return results;
  }
}
