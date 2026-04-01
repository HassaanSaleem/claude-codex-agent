import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PipelineRun, PipelineRunSummary } from '../domain/types.js';
import type { IArtifactService, IRetentionService } from '../domain/interfaces.js';

export class ArtifactService implements IArtifactService {
  constructor(private retentionService?: IRetentionService, private retentionLimit?: number) {}
  async createRunDirectory(runId: string, workspacePath: string, runDirectory: string): Promise<string> {
    const runDir = path.join(workspacePath, runDirectory, runId);
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(path.join(runDir, 'stages'), { recursive: true });
    return runDir;
  }

  async writeStageArtifact(
    runDir: string,
    stageName: string,
    iteration: number,
    fileName: string,
    content: string,
  ): Promise<void> {
    const stageDir = iteration === 0
      ? path.join(runDir, 'stages', stageName)
      : path.join(runDir, 'iterations', `iter_${iteration}`, stageName);

    await fs.mkdir(stageDir, { recursive: true });
    await fs.writeFile(path.join(stageDir, fileName), content, 'utf-8');
  }

  async writeRunManifest(runDir: string, run: PipelineRun): Promise<void> {
    await fs.writeFile(
      path.join(runDir, 'run_manifest.json'),
      JSON.stringify(run, null, 2),
      'utf-8',
    );
  }

  async readRunManifest(runDir: string): Promise<PipelineRun> {
    const content = await fs.readFile(
      path.join(runDir, 'run_manifest.json'),
      'utf-8',
    );
    return JSON.parse(content) as PipelineRun;
  }

  async writeSpecDoc(specDir: string, relativePath: string, content: string): Promise<void> {
    const fullPath = path.resolve(specDir, relativePath);
    // Guard against path traversal from LLM-generated file markers
    const resolvedSpecDir = path.resolve(specDir);
    if (!fullPath.startsWith(resolvedSpecDir + path.sep) && fullPath !== resolvedSpecDir) {
      throw new Error(`Path traversal blocked: "${relativePath}" escapes spec directory`);
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async findRunDir(workspacePath: string, runDirectory: string, runId: string): Promise<string | null> {
    const specsDir = path.join(workspacePath, runDirectory);
    try {
      const entries = await fs.readdir(specsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidateDir = path.join(specsDir, entry.name);
        try {
          const manifest = await this.readRunManifest(candidateDir);
          if (manifest.runId === runId) return candidateDir;
        } catch {
          // No manifest or invalid — skip
        }
      }
    } catch {
      // Directory doesn't exist
    }
    return null;
  }

  async listRuns(workspacePath: string, runDirectory: string): Promise<PipelineRunSummary[]> {
    // Lazy retention cleanup on history view (FR-023)
    if (this.retentionService && this.retentionLimit) {
      try {
        await this.retentionService.enforceRetention(workspacePath, runDirectory, this.retentionLimit);
      } catch {
        // Retention failure never propagates
      }
    }

    const specsDir = path.join(workspacePath, runDirectory);

    try {
      const entries = await fs.readdir(specsDir, { withFileTypes: true });
      const summaries: PipelineRunSummary[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const entryDir = path.join(specsDir, entry.name);
          const manifest = await this.readRunManifest(entryDir);
          summaries.push({
            runId: manifest.runId,
            taskDescription: manifest.taskDescription,
            status: manifest.status,
            startedAt: manifest.startedAt,
            endedAt: manifest.endedAt,
            iterationCount: manifest.iterationCount,
            runDir: entryDir,
          });
        } catch {
          // Skip directories without valid manifests
        }
      }

      return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    } catch {
      return [];
    }
  }
}
