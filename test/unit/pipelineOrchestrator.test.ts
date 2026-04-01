import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineOrchestrator, type PipelineCallbacks } from '../../src/services/pipelineOrchestrator.js';
import type { IClaudeAgent, ICodexAgent, IGateRunner, IArtifactService, IGitService } from '../../src/domain/interfaces.js';
import type { PipelineConfig, GateResult } from '../../src/domain/types.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function makeCallbacks(): PipelineCallbacks {
  return {
    onStageStart: vi.fn(),
    onStageComplete: vi.fn(),
    onStageFail: vi.fn(),
    onStream: vi.fn(),
    onGateResult: vi.fn(),
    onPatchBudgetExceeded: vi.fn().mockResolvedValue(false),
    onHumanApprovalRequired: vi.fn().mockResolvedValue({ decision: 'approve' }),
  };
}

function passingGate(name: string): GateResult {
  return {
    toolName: name,
    command: `run-${name}`,
    exitCode: 0,
    passed: true,
    stdout: 'ok',
    stderr: '',
    durationSeconds: 1,
    timeoutExceeded: false,
  };
}

function failingGate(name: string): GateResult {
  return {
    toolName: name,
    command: `run-${name}`,
    exitCode: 1,
    passed: false,
    stdout: 'Error found',
    stderr: 'test failed',
    durationSeconds: 2,
    timeoutExceeded: false,
  };
}

describe('PipelineOrchestrator', () => {
  let claudeAgent: IClaudeAgent;
  let codexAgent: ICodexAgent;
  let gateRunner: IGateRunner;
  let artifactService: IArtifactService;
  let gitService: IGitService;
  let callbacks: PipelineCallbacks;

  beforeEach(() => {
    claudeAgent = {
      plan: vi.fn().mockResolvedValue('## Plan\n- Step 1\n- Step 2'),
      fixPlan: vi.fn().mockResolvedValue('## Revised Plan\n- Step 1 (fixed)\n- Step 2'),
      implement: vi.fn().mockResolvedValue('Implemented changes'),
      chat: vi.fn().mockResolvedValue('Chat response'),
      generateSpecDocs: vi.fn().mockResolvedValue(''),
      resetSession: vi.fn(),
      getCliSessionId: vi.fn().mockReturnValue(null),
      setCliSessionId: vi.fn(),
      kill: vi.fn(),
    };

    codexAgent = {
      verifyPlan: vi.fn().mockResolvedValue('PASS: Plan looks good'),
      audit: vi.fn().mockResolvedValue('PASS: All changes aligned'),
      chat: vi.fn().mockResolvedValue('Chat response'),
      resetSession: vi.fn(),
      kill: vi.fn(),
    };

    gateRunner = {
      runGates: vi.fn().mockResolvedValue([passingGate('test'), passingGate('lint')]),
    };

    artifactService = {
      createRunDirectory: vi.fn().mockResolvedValue('/mock/runs/run123'),
      writeStageArtifact: vi.fn().mockResolvedValue(undefined),
      writeRunManifest: vi.fn().mockResolvedValue(undefined),
      writeSpecDoc: vi.fn().mockResolvedValue(undefined),
      readRunManifest: vi.fn(),
      listRuns: vi.fn(),
    };

    gitService = {
      getDiff: vi.fn().mockResolvedValue('+added line\n-removed line'),
    };

    callbacks = makeCallbacks();
  });

  describe('plan stage', () => {
    it('calls claude agent plan with task description', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('add health check', '/workspace', makeConfig(), callbacks);

      expect(claudeAgent.plan).toHaveBeenCalledWith(
        'add health check',
        '/workspace',
        expect.any(Object),
        expect.any(Function),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('writes plan artifact to run directory', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('add health check', '/workspace', makeConfig(), callbacks);

      expect(artifactService.writeStageArtifact).toHaveBeenCalledWith(
        '/mock/runs/run123',
        '01_plan',
        0,
        'cli_output.jsonl',
        expect.any(String),
      );
      expect(artifactService.writeStageArtifact).toHaveBeenCalledWith(
        '/mock/runs/run123',
        '01_plan',
        0,
        'plan.json',
        expect.any(String),
      );
    });

    it('fires onStageStart and onStageComplete for plan', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(callbacks.onStageStart).toHaveBeenCalledWith('plan', 0);
      expect(callbacks.onStageComplete).toHaveBeenCalledWith('plan', 0);
    });
  });

  describe('review_plan stage', () => {
    it('calls codex agent verifyPlan with plan output', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(codexAgent.verifyPlan).toHaveBeenCalledWith(
        '## Plan\n- Step 1\n- Step 2',
        '/workspace',
        expect.any(Object),
        expect.any(Function),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('writes review artifact', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(artifactService.writeStageArtifact).toHaveBeenCalledWith(
        '/mock/runs/run123',
        '02_review_plan',
        0,
        'cli_output.jsonl',
        expect.any(String),
      );
    });

    it('fires stage callbacks for review_plan', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(callbacks.onStageStart).toHaveBeenCalledWith('review_plan', 0);
      expect(callbacks.onStageComplete).toHaveBeenCalledWith('review_plan', 0);
    });
  });

  describe('fix_plan stage', () => {
    it('auto-revises plan when review says REVISE', async () => {
      vi.mocked(codexAgent.verifyPlan).mockResolvedValue('REVISE: Missing error handling in step 2');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(claudeAgent.fixPlan).toHaveBeenCalledWith(
        '## Plan\n- Step 1\n- Step 2',
        'REVISE: Missing error handling in step 2',
        '/workspace',
        expect.any(Object),
        expect.any(Function),
        expect.any(AbortSignal),
        undefined,
      );
      expect(callbacks.onStageStart).toHaveBeenCalledWith('fix_plan', 0);
      expect(callbacks.onStageComplete).toHaveBeenCalledWith('fix_plan', 0);
    });

    it('skips fix_plan when review says PASS', async () => {
      vi.mocked(codexAgent.verifyPlan).mockResolvedValue('PASS: Plan looks solid');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(claudeAgent.fixPlan).not.toHaveBeenCalled();
    });
  });

  describe('human_approval stage', () => {
    it('requests human approval and continues on approve', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(callbacks.onHumanApprovalRequired).toHaveBeenCalled();
      expect(callbacks.onStageStart).toHaveBeenCalledWith('human_approval', 0);
      expect(callbacks.onStageComplete).toHaveBeenCalledWith('human_approval', 0);
      expect(run.status).toBe('passed');
    });

    it('loops back to plan when human sends back for re-plan', async () => {
      vi.mocked(callbacks.onHumanApprovalRequired)
        .mockResolvedValueOnce({ decision: 'edit_and_replan', additionalContext: 'Add caching support' })
        .mockResolvedValueOnce({ decision: 'approve' });

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig(), callbacks);

      // Plan should be called twice (initial + re-plan)
      expect(claudeAgent.plan).toHaveBeenCalledTimes(2);
      // Second plan call should include additional context
      expect(vi.mocked(claudeAgent.plan).mock.calls[1][0]).toContain('Add caching support');
      expect(run.status).toBe('passed');
    });
  });

  describe('implement stage', () => {
    it('calls claude agent implement with plan context', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(claudeAgent.implement).toHaveBeenCalledWith(
        expect.stringContaining('## Plan'),
        '/workspace',
        expect.any(Object),
        expect.any(Function),
        expect.any(AbortSignal),
        undefined,
      );
    });

    it('captures diff after implementation', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(gitService.getDiff).toHaveBeenCalledWith('/workspace');
      expect(artifactService.writeStageArtifact).toHaveBeenCalledWith(
        '/mock/runs/run123',
        '03_implement',
        0,
        'diff.patch',
        '+added line\n-removed line',
      );
    });

    it('fires stage callbacks for implement', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(callbacks.onStageStart).toHaveBeenCalledWith('implement', 0);
      expect(callbacks.onStageComplete).toHaveBeenCalledWith('implement', 0);
    });
  });

  describe('audit stage', () => {
    it('calls codex agent audit with plan+diff+gates context', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      // audit is now called with combined context (plan + diff + gate results)
      const auditCall = vi.mocked(codexAgent.audit).mock.calls[0];
      expect(auditCall[0]).toContain('## Plan');
      expect(auditCall[0]).toContain('## Implementation Diff');
    });

    it('writes audit artifact', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(artifactService.writeStageArtifact).toHaveBeenCalledWith(
        '/mock/runs/run123',
        '04_audit',
        0,
        'cli_output.jsonl',
        expect.any(String),
      );
    });

    it('detects FIX_REQUIRED verdict and triggers fix loop', async () => {
      vi.mocked(codexAgent.audit)
        .mockResolvedValueOnce('FIX_REQUIRED: missing test coverage')
        .mockResolvedValueOnce('PASS: All good now');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ maxIterations: 3 }), callbacks);

      expect(run.status).toBe('passed');
      expect(claudeAgent.implement).toHaveBeenCalledTimes(2);
      expect(codexAgent.audit).toHaveBeenCalledTimes(2);
    });
  });

  describe('fix loop', () => {
    it('iterates when audit fails and re-runs implement/audit', async () => {
      vi.mocked(codexAgent.audit)
        .mockResolvedValueOnce('FIX_REQUIRED: test failures')
        .mockResolvedValueOnce('PASS: All good');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ maxIterations: 3 }), callbacks);

      expect(run.status).toBe('passed');
      expect(claudeAgent.implement).toHaveBeenCalledTimes(2);
    });

    it('fails after exhausting max iterations', async () => {
      vi.mocked(codexAgent.audit).mockResolvedValue('FIX_REQUIRED: still broken');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ maxIterations: 2 }), callbacks);

      expect(run.status).toBe('failed');
      expect(run.finalOutcome).toContain('Fix loop exhausted');
      expect(claudeAgent.implement).toHaveBeenCalledTimes(2);
    });

    it('passes fix context with gate failures and audit output on retry', async () => {
      vi.mocked(gateRunner.runGates)
        .mockResolvedValueOnce([failingGate('lint')])
        .mockResolvedValueOnce([passingGate('lint')]);
      vi.mocked(codexAgent.audit)
        .mockResolvedValueOnce('FIX_REQUIRED: lint issues')
        .mockResolvedValueOnce('PASS');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig({ maxIterations: 3 }), callbacks);

      // Second implement call should have fix context
      const secondCall = vi.mocked(claudeAgent.implement).mock.calls[1];
      const context = secondCall[0];
      expect(context).toContain('## Gate Failures');
      expect(context).toContain('lint');
      expect(context).toContain('## Audit Findings');
      expect(context).toContain('FIX_REQUIRED');
    });

    it('enforces patch budget and cancels if not approved', async () => {
      // Return a large diff
      vi.mocked(gitService.getDiff).mockResolvedValue(
        Array(600).fill('+new line').join('\n'),
      );

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ patchBudget: 100 }), callbacks);

      expect(run.status).toBe('cancelled');
      expect(run.finalOutcome).toContain('Patch budget exceeded');
      expect(callbacks.onPatchBudgetExceeded).toHaveBeenCalled();
    });

    it('continues if patch budget is approved', async () => {
      vi.mocked(gitService.getDiff).mockResolvedValue(
        Array(600).fill('+new line').join('\n'),
      );
      vi.mocked(callbacks.onPatchBudgetExceeded).mockResolvedValue(true);

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ patchBudget: 100 }), callbacks);

      expect(run.status).toBe('passed');
    });

    it('does not use git operations during workflow', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('add endpoint', '/workspace', makeConfig(), callbacks);

      expect(run.status).toBe('passed');
    });

    it('writes run manifest at end', async () => {
      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(artifactService.writeRunManifest).toHaveBeenCalledWith(
        '/mock/runs/run123',
        expect.objectContaining({
          status: 'passed',
          endedAt: expect.any(String),
        }),
      );
    });
  });

  describe('cancellation', () => {
    it('stops pipeline when cancel is called between stages', async () => {
      vi.mocked(claudeAgent.plan).mockImplementation(async () => {
        return 'plan output';
      });
      vi.mocked(codexAgent.verifyPlan).mockImplementation(async () => {
        return 'PASS: looks good';
      });

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);

      // Cancel after human_approval stage callback fires
      let implementCallCount = 0;
      vi.mocked(claudeAgent.implement).mockImplementation(async () => {
        implementCallCount++;
        return 'implement output';
      });

      // Cancel when human approval is requested — before implementation starts
      vi.mocked(callbacks.onHumanApprovalRequired).mockImplementation(async () => {
        orch.cancel();
        return { decision: 'approve' as const };
      });

      const run = await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(run.status).toBe('cancelled');
      expect(run.finalOutcome).toContain('Cancelled');
      expect(implementCallCount).toBe(0);
    });
  });

  describe('cannot proceed detection', () => {
    it('halts pipeline when plan output contains CANNOT_PROCEED', async () => {
      vi.mocked(claudeAgent.plan).mockResolvedValue('CANNOT_PROCEED: The requirements are contradictory. Cannot add a feature that both enables and disables auth.');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('contradictory task', '/workspace', makeConfig(), callbacks);

      expect(run.status).toBe('failed');
      expect(run.finalOutcome).toContain('Cannot proceed');
      expect(codexAgent.verifyPlan).not.toHaveBeenCalled();
      expect(claudeAgent.implement).not.toHaveBeenCalled();
    });

    it('halts pipeline when plan output contains AMBIGUOUS REQUIREMENTS', async () => {
      vi.mocked(claudeAgent.plan).mockResolvedValue('I found AMBIGUOUS REQUIREMENTS in the task. Please clarify whether the endpoint should use REST or GraphQL.');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('vague task', '/workspace', makeConfig(), callbacks);

      expect(run.status).toBe('failed');
      expect(run.finalOutcome).toContain('Cannot proceed');
    });

    it('continues when plan output is normal', async () => {
      vi.mocked(claudeAgent.plan).mockResolvedValue('## Plan\n- Step 1: Add endpoint\n- Step 2: Add test');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('add endpoint', '/workspace', makeConfig(), callbacks);

      expect(run.status).toBe('passed');
      expect(codexAgent.verifyPlan).toHaveBeenCalled();
    });
  });

  describe('audit verdict parsing', () => {
    it('treats PASS even when preamble mentions FIX_REQUIRED as methodology', async () => {
      // Simulates the real-world bug: Codex auditor writes
      // "I'll report a strict PASS/FIX_REQUIRED verdict" in its preamble,
      // but the actual verdict is PASS.
      const auditWithPreamble = [
        'Reviewing the implementation against your plan first,',
        "then I'll validate behavior before giving a strict PASS/FIX_REQUIRED verdict.",
        '',
        '**Verdict: PASS**',
        '',
        'Implementation matches the plan and diff with no blocking issues.',
      ].join('\n');

      vi.mocked(codexAgent.audit).mockResolvedValue(auditWithPreamble);

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(run.status).toBe('passed');
      expect(claudeAgent.implement).toHaveBeenCalledTimes(1);
      expect(codexAgent.audit).toHaveBeenCalledTimes(1);
    });

    it('detects FIX_REQUIRED at the start of a line as a real verdict', async () => {
      vi.mocked(codexAgent.audit).mockResolvedValue(
        'Some analysis...\nFIX_REQUIRED\n\n1. Missing test coverage for edge case',
      );

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ maxIterations: 1 }), callbacks);

      expect(run.status).toBe('failed');
      expect(run.finalOutcome).toContain('Fix loop exhausted');
    });

    it('detects **Verdict: FIX_REQUIRED** with markdown bold', async () => {
      vi.mocked(codexAgent.audit)
        .mockResolvedValueOnce('Analysis complete.\n\n**Verdict: FIX_REQUIRED**\n\n1. Missing tests')
        .mockResolvedValueOnce('**Verdict: PASS**');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ maxIterations: 3 }), callbacks);

      expect(run.status).toBe('passed');
      expect(claudeAgent.implement).toHaveBeenCalledTimes(2);
    });

    it('treats empty audit output as PASS', async () => {
      vi.mocked(codexAgent.audit).mockResolvedValue('   ');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig(), callbacks);

      expect(run.status).toBe('passed');
    });
  });

  describe('security gate enforcement', () => {
    it('triggers fix loop when audit detects security issues', async () => {
      vi.mocked(codexAgent.audit)
        .mockResolvedValueOnce('FIX_REQUIRED: CRITICAL security finding - hardcoded API key in src/config.ts')
        .mockResolvedValueOnce('PASS: Security issue resolved');

      const orch = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
      const run = await orch.run('task', '/workspace', makeConfig({ maxIterations: 3 }), callbacks);

      expect(run.status).toBe('passed');
      expect(claudeAgent.implement).toHaveBeenCalledTimes(2);
      // Verify fix context mentions security
      const fixContext = vi.mocked(claudeAgent.implement).mock.calls[1][0];
      expect(fixContext).toContain('security');
    });
  });
});
