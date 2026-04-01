import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ArtifactService } from '../../src/services/artifactService.js';
import type { PipelineRun } from '../../src/domain/types.js';
import { DEFAULT_CONFIG } from '../../src/domain/constants.js';

describe('ArtifactService', () => {
  let service: ArtifactService;
  let tmpDir: string;

  beforeEach(async () => {
    service = new ArtifactService();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccx-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('createRunDirectory', () => {
    it('creates run directory with stages subdirectory', async () => {
      const runDir = await service.createRunDirectory('run_001', tmpDir, 'specs');
      const stat = await fs.stat(path.join(runDir, 'stages'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('writeStageArtifact', () => {
    it('writes artifact to correct stage directory', async () => {
      const runDir = await service.createRunDirectory('run_001', tmpDir, 'specs');
      await service.writeStageArtifact(runDir, '01_plan', 0, 'plan.json', '{"planText":"test"}');

      const content = await fs.readFile(
        path.join(runDir, 'stages', '01_plan', 'plan.json'),
        'utf-8',
      );
      expect(content).toBe('{"planText":"test"}');
    });

    it('writes iteration artifacts to iterations directory', async () => {
      const runDir = await service.createRunDirectory('run_001', tmpDir, 'specs');
      await service.writeStageArtifact(runDir, '03_implement', 1, 'impl.json', '{}');

      const content = await fs.readFile(
        path.join(runDir, 'iterations', 'iter_1', '03_implement', 'impl.json'),
        'utf-8',
      );
      expect(content).toBe('{}');
    });
  });

  describe('writeRunManifest / readRunManifest', () => {
    it('round-trips a PipelineRun manifest', async () => {
      const runDir = await service.createRunDirectory('run_001', tmpDir, 'specs');
      const run: PipelineRun = {
        runId: 'run_001',
        taskDescription: 'Test task',
        workspacePath: tmpDir,
        branchName: 'test-branch',
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        iterationCount: 0,
        maxIterations: 3,
        patchBudget: 500,
        finalOutcome: null,
        stages: [],
        config: DEFAULT_CONFIG,
      };

      await service.writeRunManifest(runDir, run);
      const loaded = await service.readRunManifest(runDir);
      expect(loaded.runId).toBe('run_001');
      expect(loaded.taskDescription).toBe('Test task');
    });
  });

  describe('listRuns', () => {
    it('returns sorted list of run summaries', async () => {
      const run1Dir = await service.createRunDirectory('run_001', tmpDir, 'specs');
      const run2Dir = await service.createRunDirectory('run_002', tmpDir, 'specs');

      await service.writeRunManifest(run1Dir, {
        runId: 'run_001',
        taskDescription: 'First',
        workspacePath: tmpDir,
        branchName: 'b1',
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:05:00Z',
        iterationCount: 0,
        maxIterations: 3,
        patchBudget: 500,
        finalOutcome: 'pass',
        stages: [],
        config: DEFAULT_CONFIG,
      });

      await service.writeRunManifest(run2Dir, {
        runId: 'run_002',
        taskDescription: 'Second',
        workspacePath: tmpDir,
        branchName: 'b2',
        status: 'failed',
        startedAt: '2026-01-02T00:00:00Z',
        endedAt: '2026-01-02T00:03:00Z',
        iterationCount: 1,
        maxIterations: 3,
        patchBudget: 500,
        finalOutcome: 'fail',
        stages: [],
        config: DEFAULT_CONFIG,
      });

      const runs = await service.listRuns(tmpDir, 'specs');
      expect(runs).toHaveLength(2);
      expect(runs[0].runId).toBe('run_002'); // newer first
      expect(runs[1].runId).toBe('run_001');
    });

    it('returns empty array if runs directory does not exist', async () => {
      const runs = await service.listRuns(tmpDir, 'nonexistent');
      expect(runs).toEqual([]);
    });
  });
});
