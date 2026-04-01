import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineOrchestrator, type PipelineCallbacks } from '../../src/services/pipelineOrchestrator.js';
import type { PipelineConfig } from '../../src/domain/types.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';

function createMockCallbacks(): PipelineCallbacks {
  return {
    onStageStart: vi.fn(),
    onStageComplete: vi.fn(),
    onStageFail: vi.fn(),
    onStream: vi.fn(),
    onGateResult: vi.fn(),
    onPatchBudgetExceeded: vi.fn().mockResolvedValue(true),
    onHumanApprovalRequired: vi.fn().mockResolvedValue({ decision: 'approve' as const }),
  };
}

function createConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    ...DEFAULT_CONFIG,
    pipelineTimeoutSeconds: 1, // 1 second timeout for tests
    ...overrides,
  };
}

describe('Pipeline Timeout (FR-022)', () => {
  let claudeAgent: any;
  let codexAgent: any;
  let gateRunner: any;
  let artifactService: any;
  let gitService: any;
  let orchestrator: PipelineOrchestrator;

  beforeEach(() => {
    claudeAgent = {
      plan: vi.fn(),
      fixPlan: vi.fn(),
      implement: vi.fn(),
      chat: vi.fn(),
      generateSpecDocs: vi.fn().mockResolvedValue(''),
      resetSession: vi.fn(),
      getCliSessionId: vi.fn().mockReturnValue(null),
      setCliSessionId: vi.fn(),
      kill: vi.fn(),
    };
    codexAgent = {
      verifyPlan: vi.fn(),
      audit: vi.fn(),
      chat: vi.fn(),
      resetSession: vi.fn(),
      kill: vi.fn(),
    };
    gateRunner = {
      runGates: vi.fn().mockResolvedValue([]),
    };
    artifactService = {
      createRunDirectory: vi.fn().mockResolvedValue('/tmp/test-run'),
      writeStageArtifact: vi.fn().mockResolvedValue(undefined),
      writeRunManifest: vi.fn().mockResolvedValue(undefined),
      readRunManifest: vi.fn(),
      listRuns: vi.fn(),
    };
    gitService = {
      getDiff: vi.fn().mockResolvedValue(''),
    };
    orchestrator = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService);
  });

  it('sets timedOut and activeStageAtTimeout when pipeline exceeds timeout', async () => {
    // Plan stage blocks longer than the 1s timeout
    claudeAgent.plan.mockImplementation((_desc: string, _ws: string, _cfg: any, _stream: any, signal?: AbortSignal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('plan output'), 5000);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          }, { once: true });
        }
      });
    });

    const callbacks = createMockCallbacks();
    const config = createConfig({ pipelineTimeoutSeconds: 1 });
    const run = await orchestrator.run('test task', '/workspace', config, callbacks);

    expect(run.timedOut).toBe(true);
    expect(run.activeStageAtTimeout).toBe('plan');
    expect(run.status).toBe('failed');
    expect(run.finalOutcome).toContain('timed out');
    expect(run.finalOutcome).toContain('plan');
  });

  it('passes AbortSignal to agent methods', async () => {
    let receivedSignal: AbortSignal | undefined;
    claudeAgent.plan.mockImplementation((_desc: string, _ws: string, _cfg: any, _stream: any, signal?: AbortSignal) => {
      receivedSignal = signal;
      return Promise.resolve('plan output');
    });
    codexAgent.verifyPlan.mockResolvedValue('PASS');
    claudeAgent.implement.mockResolvedValue('implemented');
    codexAgent.audit.mockResolvedValue('PASS');

    const callbacks = createMockCallbacks();
    const config = createConfig({ pipelineTimeoutSeconds: 30 });
    await orchestrator.run('test task', '/workspace', config, callbacks);

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('clears timeout on normal pipeline completion (no false abort)', async () => {
    claudeAgent.plan.mockResolvedValue('plan output');
    codexAgent.verifyPlan.mockResolvedValue('PASS');
    claudeAgent.implement.mockResolvedValue('implemented');
    codexAgent.audit.mockResolvedValue('PASS');

    const callbacks = createMockCallbacks();
    const config = createConfig({ pipelineTimeoutSeconds: 30 });
    const run = await orchestrator.run('test task', '/workspace', config, callbacks);

    expect(run.timedOut).toBe(false);
    expect(run.activeStageAtTimeout).toBeNull();
    expect(run.status).toBe('passed');
  });

  it('writes partial manifest on timeout', async () => {
    claudeAgent.plan.mockImplementation((_desc: string, _ws: string, _cfg: any, _stream: any, signal?: AbortSignal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('plan output'), 5000);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          }, { once: true });
        }
      });
    });

    const callbacks = createMockCallbacks();
    const config = createConfig({ pipelineTimeoutSeconds: 1 });
    await orchestrator.run('test task', '/workspace', config, callbacks);

    // writeRunManifest should be called with timedOut=true
    expect(artifactService.writeRunManifest).toHaveBeenCalled();
    const [, manifest] = artifactService.writeRunManifest.mock.calls[0];
    expect(manifest.timedOut).toBe(true);
  });

  it('reports timeout with stage name and elapsed time in finalOutcome', async () => {
    claudeAgent.plan.mockImplementation((_desc: string, _ws: string, _cfg: any, _stream: any, signal?: AbortSignal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('plan output'), 5000);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          }, { once: true });
        }
      });
    });

    const callbacks = createMockCallbacks();
    const config = createConfig({ pipelineTimeoutSeconds: 1 });
    const run = await orchestrator.run('test task', '/workspace', config, callbacks);

    expect(run.finalOutcome).toContain('timed out');
    expect(run.finalOutcome).toContain('plan');
    expect(run.finalOutcome).toContain('0 minutes'); // 1 second = 0 rounded minutes
  });
});
