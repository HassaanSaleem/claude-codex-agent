import { runCommand } from '../infra/subprocessRunner.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface PrCreationResult {
  success: boolean;
  prUrl: string | null;
  error: string | null;
}

export async function createPullRequest(
  workspacePath: string,
  runDir: string,
  branchName: string,
): Promise<PrCreationResult> {
  // Check if gh CLI is available
  const ghCheck = await runCommand('gh', ['--version'], {
    cwd: workspacePath,
    timeoutMs: 10_000,
  });

  if (ghCheck.exitCode === 127) {
    return {
      success: false,
      prUrl: null,
      error: 'GitHub CLI (gh) not found. Install from https://cli.github.com/ or create the PR manually.',
    };
  }

  // Read PR description
  let body: string;
  try {
    body = await fs.readFile(path.join(runDir, 'pr_description.md'), 'utf-8');
  } catch {
    body = `Automated changes on branch ${branchName}`;
  }

  // Push branch
  const push = await runCommand('git', ['push', '-u', 'origin', branchName], {
    cwd: workspacePath,
    timeoutMs: 60_000,
  });

  if (push.exitCode !== 0) {
    return {
      success: false,
      prUrl: null,
      error: `Failed to push branch: ${push.stderr.slice(0, 500)}`,
    };
  }

  // Extract title from first line of body or use branch name
  const title = body.split('\n')[0].replace(/^#+\s*/, '').trim() || branchName;

  // Create PR
  const pr = await runCommand('gh', ['pr', 'create', '--title', title, '--body', body], {
    cwd: workspacePath,
    timeoutMs: 30_000,
  });

  if (pr.exitCode !== 0) {
    return {
      success: false,
      prUrl: null,
      error: `Failed to create PR: ${pr.stderr.slice(0, 500)}`,
    };
  }

  const prUrl = pr.stdout.trim();
  return { success: true, prUrl, error: null };
}
