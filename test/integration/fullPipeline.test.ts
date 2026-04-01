import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineOrchestrator, type PipelineCallbacks } from '../../src/services/pipelineOrchestrator.js';
import type { IClaudeAgent, ICodexAgent, IGateRunner, IArtifactService, IGitService } from '../../src/domain/interfaces.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Full Pipeline Integration', () => {
  let tmpDir: string;
  let claudeAgent: IClaudeAgent;
  let codexAgent: ICodexAgent;
  let gateRunner: IGateRunner;
  let gitService: IGitService;
  let callbacks: PipelineCallbacks;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccx-pipeline-integ-'));

    claudeAgent = {
      plan: vi.fn().mockResolvedValue('## Plan\n- Add health check\n- Add test'),
      fixPlan: vi.fn().mockResolvedValue('## Revised Plan\n- Add health check (fixed)\n- Add test'),
      implement: vi.fn().mockResolvedValue('Files created and modified.'),
      chat: vi.fn().mockResolvedValue('Chat response'),
      generateSpecDocs: vi.fn().mockResolvedValue(''),
      resetSession: vi.fn(),
      getCliSessionId: vi.fn().mockReturnValue(null),
      setCliSessionId: vi.fn(),
      kill: vi.fn(),
    };

    codexAgent = {
      verifyPlan: vi.fn().mockResolvedValue('PASS: Plan is solid.'),
      audit: vi.fn().mockResolvedValue('PASS: All changes aligned.'),
      chat: vi.fn().mockResolvedValue('Chat response'),
      resetSession: vi.fn(),
      kill: vi.fn(),
    };

    gateRunner = {
      runGates: vi.fn().mockResolvedValue([
        { toolName: 'test', command: 'pytest', exitCode: 0, passed: true, stdout: 'ok', stderr: '', durationSeconds: 1, timeoutExceeded: false },
        { toolName: 'lint', command: 'ruff', exitCode: 0, passed: true, stdout: 'ok', stderr: '', durationSeconds: 0.5, timeoutExceeded: false },
      ]),
    };

    gitService = {
      getDiff: vi.fn().mockResolvedValue('+health_check\n-placeholder'),
    };

    callbacks = {
      onStageStart: vi.fn(),
      onStageComplete: vi.fn(),
      onStageFail: vi.fn(),
      onStream: vi.fn(),
      onGateResult: vi.fn(),
      onPatchBudgetExceeded: vi.fn().mockResolvedValue(false),
      onHumanApprovalRequired: vi.fn().mockResolvedValue({ decision: 'approve' }),
    };
  });

  it('runs full pipeline: plan -> review -> approval -> implement -> audit -> commit', async () => {
    // Use real artifact service with temp directory
    const { ArtifactService } = await import('../../src/services/artifactService.js');
    const artifactService = new ArtifactService();

    const config = {
      ...DEFAULT_CONFIG,
      runDirectory: 'specs',
    };

    const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
    const run = await orch.run('add a health check endpoint', tmpDir, config, callbacks);

    // Verify pipeline passed
    expect(run.status).toBe('passed');
    expect(run.finalOutcome).toContain('Audit passed');

    // Verify all stages were called
    expect(claudeAgent.plan).toHaveBeenCalledTimes(1);
    expect(codexAgent.verifyPlan).toHaveBeenCalledTimes(1);
    expect(callbacks.onHumanApprovalRequired).toHaveBeenCalledTimes(1);
    expect(claudeAgent.implement).toHaveBeenCalledTimes(1);
    expect(codexAgent.audit).toHaveBeenCalledTimes(1);
    // Verify stage callbacks were fired in order
    const startCalls = vi.mocked(callbacks.onStageStart).mock.calls.map(c => c[0]);
    expect(startCalls).toEqual(['plan', 'review_plan', 'human_approval', 'implement', 'audit']);

    // Verify artifacts were written
    const specsDir = path.join(tmpDir, 'specs');
    const runDirs = await fs.readdir(specsDir);
    expect(runDirs).toHaveLength(1);

    const runDir = path.join(specsDir, runDirs[0]);
    const manifest = JSON.parse(await fs.readFile(path.join(runDir, 'run_manifest.json'), 'utf-8'));
    expect(manifest.status).toBe('passed');
    expect(manifest.taskDescription).toBe('add a health check endpoint');

    // Verify stage artifacts exist
    const stagesDir = path.join(runDir, 'stages');
    const planDir = await fs.readdir(path.join(stagesDir, '01_plan'));
    expect(planDir).toContain('cli_output.jsonl');
    expect(planDir).toContain('plan.json');

    const reviewDir = await fs.readdir(path.join(stagesDir, '02_review_plan'));
    expect(reviewDir).toContain('cli_output.jsonl');

    const implDir = await fs.readdir(path.join(stagesDir, '03_implement'));
    expect(implDir).toContain('cli_output.jsonl');
    expect(implDir).toContain('diff.patch');
  });

  it('runs fix loop when audit fails', async () => {
    const { ArtifactService } = await import('../../src/services/artifactService.js');
    const artifactService = new ArtifactService();

    vi.mocked(codexAgent.audit)
      .mockResolvedValueOnce('FIX_REQUIRED: test failures')
      .mockResolvedValueOnce('PASS: Fixed');

    const config = { ...DEFAULT_CONFIG, maxIterations: 3, runDirectory: 'specs' };
    const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
    const run = await orch.run('fix tests', tmpDir, config, callbacks);

    expect(run.status).toBe('passed');
    expect(claudeAgent.implement).toHaveBeenCalledTimes(2);
    expect(codexAgent.audit).toHaveBeenCalledTimes(2);

    // Verify iteration artifacts
    const specsDir = path.join(tmpDir, 'specs');
    const runDirs = await fs.readdir(specsDir);
    const runDir = path.join(specsDir, runDirs[0]);
    const iterDir = path.join(runDir, 'iterations', 'iter_1');
    const iterContents = await fs.readdir(iterDir);
    expect(iterContents.length).toBeGreaterThan(0);
  });
});
