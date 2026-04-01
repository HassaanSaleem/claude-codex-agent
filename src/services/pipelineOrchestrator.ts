import type {
  PipelineConfig,
  PipelineRun,
  StageRecord,
  StageName,
  GateResult,
  HumanApprovalDecision,
  ClarificationQuestion,
  SpecFeature,
  TokenUsage,
} from '../domain/types.js';
import type {
  IClaudeAgent,
  ICodexAgent,
  IGateRunner,
  IArtifactService,
  IGitService,
  IRetentionService,
  StreamCallback,
  TokenUsageCallback,
} from '../domain/interfaces.js';
import { STAGE_ORDER } from '../domain/constants.js';
import { generateRunId } from '../utils/runId.js';
import { parseDiffStats } from '../utils/patchBudget.js';
import { detectQuestions } from '../utils/cliOutputParser.js';

export interface HumanApprovalResponse {
  decision: HumanApprovalDecision;
  additionalContext?: string;
}

export interface PipelineResumeState {
  planOutput: string;
  reviewFeedback: string;
  humanContext: string;
  resumeFromStage: 'implement' | 'audit' | 'document';
  iteration: number;
}

export interface PipelineCallbacks {
  onStageStart: (stage: StageName, iteration: number) => void;
  onStageComplete: (stage: StageName, iteration: number) => void;
  onStageFail: (stage: StageName, iteration: number, error: string) => void;
  onStream: (stage: StageName, text: string) => void;
  onGateResult: (result: GateResult) => void;
  onPatchBudgetExceeded: (linesChanged: number, budget: number) => Promise<boolean>;
  onHumanApprovalRequired: (planText: string, reviewFeedback: string) => Promise<HumanApprovalResponse>;
  onClarificationNeeded?: (questions: ClarificationQuestion[]) => Promise<{ questionId: string; answer: string }[]>;
  onTokenUsage?: (stage: StageName, usage: TokenUsage) => void;
}

export class PipelineOrchestrator {
  private cancelled = false;
  private currentStageName: StageName | null = null;
  private pipelineAbortController: AbortController | null = null;

  constructor(
    private claudeAgent: IClaudeAgent,
    private codexAgent: ICodexAgent,
    private gateRunner: IGateRunner,
    private artifactService: IArtifactService,
    private gitService: IGitService,
    private retentionService?: IRetentionService,
  ) {}

  async run(
    taskDescription: string,
    workspacePath: string,
    config: PipelineConfig,
    callbacks: PipelineCallbacks,
    specFeature?: SpecFeature,
    resumeState?: PipelineResumeState,
  ): Promise<PipelineRun> {
    this.cancelled = false;
    const runId = generateRunId();
    const branchName = `claudecodex/${runId}`;
    const runDir = specFeature
      ? specFeature.specDir
      : await this.artifactService.createRunDirectory(runId, workspacePath, config.runDirectory);

    // Pipeline-level timeout via AbortController (FR-022)
    const controller = new AbortController();
    this.pipelineAbortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), config.pipelineTimeoutSeconds * 1000);

    const run: PipelineRun = {
      runId,
      taskDescription,
      workspacePath,
      branchName,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      iterationCount: 0,
      maxIterations: config.maxIterations,
      patchBudget: config.patchBudget,
      finalOutcome: null,
      stages: [],
      config,
      timedOut: false,
      activeStageAtTimeout: null,
      clarifications: [],
    };

    try {
      let planOutput: string;
      let reviewFeedback: string;
      let humanContext: string;

      if (resumeState) {
        // ── RESUME: Skip Phase 1, use saved intermediate state ──────
        planOutput = resumeState.planOutput;
        reviewFeedback = resumeState.reviewFeedback;
        humanContext = resumeState.humanContext;
        run.intermediateState = { planOutput, reviewFeedback, humanContext };
      } else {
        // ── PHASE 1: Plan Loop ──────────────────────────────────────────

        const planResult = await this.runPlanPhase(run, taskDescription, workspacePath, config, runDir, callbacks, controller.signal);
        planOutput = planResult.planOutput;

        // Check for "cannot proceed" indicators
        if (this.detectCannotProceed(planOutput)) {
          run.status = 'failed';
          run.finalOutcome = `Cannot proceed: ${planOutput.slice(0, 500)}`;
          run.endedAt = new Date().toISOString();
          await this.artifactService.writeRunManifest(runDir, run);
          return run;
        }

        reviewFeedback = planResult.reviewFeedback;
        humanContext = planResult.humanContext;

        // Store intermediate state so retries can skip Phase 1
        run.intermediateState = { planOutput, reviewFeedback, humanContext };
      }

      // ── PHASE 2: Implement + Audit Loop ─────────────────────────────

      let lastDiff = '';
      let lastAuditOutput = '';
      let lastGateResults: GateResult[] = [];
      let iteration = resumeState?.iteration ?? 0;
      let auditPassed = false;
      // Combine review feedback and human approval context for the implement stage
      const combinedFeedback = [
        reviewFeedback,
        humanContext ? `## Human Instructions\n${humanContext}` : '',
      ].filter(Boolean).join('\n\n');
      let implementContext = this.buildImplementContext(planOutput, combinedFeedback);

      // When resuming from 'document', skip Phase 2 entirely — code is already in workspace
      const skipPhase2 = resumeState?.resumeFromStage === 'document';
      // When resuming from 'audit', skip the implement stage on the first iteration
      let skipImplement = resumeState?.resumeFromStage === 'audit';

      if (!skipPhase2) {
        while (iteration < config.maxIterations && !auditPassed) {
          this.checkCancelled();

          if (!skipImplement) {
            // Implement
            const implOutput = await this.runStage(run, 'implement', iteration, runDir, callbacks, async (onStream, onTokenUsage) => {
              return this.claudeAgent.implement(implementContext, workspacePath, config, onStream, controller.signal, onTokenUsage);
            });

            try { await this.artifactService.writeStageArtifact(runDir, '03_implement', iteration, 'cli_output.jsonl', implOutput); } catch { /* artifact write failure is non-fatal */ }
          }
          // After the first resumed iteration, always run implement
          skipImplement = false;

          // Capture diff for audit context (best-effort — skip patch budget if git unavailable)
          let diff = '';
          lastGateResults = [];
          try {
            diff = await this.gitService.getDiff(workspacePath);
            try { await this.artifactService.writeStageArtifact(runDir, '03_implement', iteration, 'diff.patch', diff); } catch { /* artifact write failure is non-fatal */ }

            const stats = parseDiffStats(diff);
            if (stats.totalChanged > config.patchBudget) {
              const approved = await callbacks.onPatchBudgetExceeded(stats.totalChanged, config.patchBudget);
              if (!approved) {
                run.status = 'cancelled';
                run.finalOutcome = `Patch budget exceeded: ${stats.totalChanged} lines changed (budget: ${config.patchBudget})`;
                break;
              }
            }
          } catch {
            // Git not available or no tracked changes — skip patch budget check
          }

          lastDiff = diff;

          // Run gates inline (if configured) — results fed to audit
          this.checkCancelled();
          const gateResults = await this.gateRunner.runGates(config, workspacePath);
          lastGateResults = gateResults;
          for (const result of gateResults) {
            try { callbacks.onGateResult(result); } catch { /* callback error must not crash pipeline */ }
          }

          // Check cancellation after gates
          this.checkCancelled();

          // Audit with plan + diff + gate results as context
          const auditContext = this.buildAuditContext(planOutput, diff, gateResults);
          let auditOutput = await this.runStage(run, 'audit', iteration, runDir, callbacks, async (onStream, onTokenUsage) => {
            return this.codexAgent.audit(auditContext, workspacePath, config, onStream, controller.signal, onTokenUsage);
          });

          // Guard against empty audit — treat as PASS with a warning
          if (!auditOutput.trim()) {
            auditOutput = 'PASS (auditor returned no output — implementation was not audited)';
          }

          lastAuditOutput = auditOutput;
          try { await this.artifactService.writeStageArtifact(runDir, '04_audit', iteration, 'cli_output.jsonl', auditOutput); } catch { /* artifact write failure is non-fatal */ }
          try { await this.artifactService.writeStageArtifact(runDir, '04_audit', iteration, 'audit.json', JSON.stringify({ rawOutput: auditOutput }, null, 2)); } catch { /* artifact write failure is non-fatal */ }

          auditPassed = this.parseAuditVerdict(auditOutput);

          if (!auditPassed) {
            iteration++;
            run.iterationCount = iteration;

            if (iteration < config.maxIterations) {
              this.checkCancelled();
              const failedGates = gateResults.filter((g) => !g.passed);
              implementContext = this.buildFixContext(planOutput, failedGates, auditOutput);
            }
          }
        }
      } else {
        // Resuming from document — mark audit as passed so we skip to Phase 3
        auditPassed = true;
      }

      if (run.status === 'cancelled') {
        // Cancelled by patch budget rejection or user
      } else if (this.cancelled) {
        run.status = 'cancelled';
        run.finalOutcome = 'Cancelled by user';
      } else if (auditPassed) {
        run.status = 'passed';
        run.finalOutcome = 'Audit passed';
      } else {
        run.status = 'failed';
        run.finalOutcome = `Fix loop exhausted after ${iteration} iterations`;
      }

      // ── PHASE 3: Document (speckit generation) ────────────────────
      // Only runs when specFeature is provided and pipeline completed (passed or failed, not cancelled)
      if (specFeature && run.status !== 'cancelled') {
        try {
          run.specFeature = specFeature;

          const docContext = this.buildDocumentContext(
            taskDescription, planOutput, reviewFeedback,
            humanContext, lastDiff, lastGateResults,
            lastAuditOutput, run.clarifications,
          );

          const docOutput = await this.runStage(run, 'document', 0, runDir, callbacks, async (onStream, onTokenUsage) => {
            return this.claudeAgent.generateSpecDocs(docContext, workspacePath, config, onStream, controller.signal, onTokenUsage);
          });

          // Parse ===FILE: <path>=== markers and write each file
          const specDocs = this.parseSpecDocOutput(docOutput);
          for (const [filePath, content] of specDocs) {
            await this.artifactService.writeSpecDoc(specFeature.specDir, filePath, content);
          }

          try { await this.artifactService.writeStageArtifact(runDir, '05_document', 0, 'cli_output.jsonl', docOutput); } catch { /* non-fatal */ }
        } catch (docError) {
          // Document stage failure should never fail the pipeline
          const msg = docError instanceof Error ? docError.message : String(docError);
          callbacks.onStageFail('document', 0, msg);
        }
      }
    } catch (error) {
      if (controller.signal.aborted && !this.cancelled) {
        // Pipeline-level timeout (FR-022)
        run.timedOut = true;
        run.activeStageAtTimeout = this.currentStageName;
        run.status = 'failed';
        const mins = Math.round(config.pipelineTimeoutSeconds / 60);
        run.finalOutcome = `Pipeline timed out after ${mins} minutes during stage: ${run.activeStageAtTimeout ?? 'unknown'}`;
      } else if (this.cancelled) {
        run.status = 'cancelled';
        run.finalOutcome = 'Cancelled by user';
      } else {
        run.status = 'failed';
        run.finalOutcome = error instanceof Error ? error.message : String(error);
      }
    }

    clearTimeout(timeoutId);
    this.pipelineAbortController = null;
    run.endedAt = new Date().toISOString();
    try {
      await this.artifactService.writeRunManifest(runDir, run);
    } catch {
      // Manifest write failure must never crash the pipeline — run result is still returned
    }

    // Enforce artifact retention (FR-023) — fire-and-forget, never fails pipeline
    if (this.retentionService) {
      try {
        await this.retentionService.enforceRetention(workspacePath, config.runDirectory, config.runRetentionLimit);
      } catch {
        // Retention failure must never affect pipeline outcome
      }
    }

    return run;
  }

  cancel(): void {
    this.cancelled = true;
    // Abort any running CLI subprocess immediately
    this.pipelineAbortController?.abort();
    this.pipelineAbortController = null;
  }

  private async runPlanPhase(
    run: PipelineRun,
    taskDescription: string,
    workspacePath: string,
    config: PipelineConfig,
    runDir: string,
    callbacks: PipelineCallbacks,
    signal?: AbortSignal,
  ): Promise<{ planOutput: string; reviewFeedback: string; humanContext: string }> {
    let planOutput = '';
    let planRevision = 0;

    // Outer loop: human can send back for re-plan (capped at maxPlanRevisions)
    while (planRevision <= config.maxPlanRevisions) {
      this.checkCancelled();

      // Step 1: Claude Plan
      planOutput = await this.runStage(run, 'plan', planRevision, runDir, callbacks, async (onStream, onTokenUsage) => {
        if (planRevision === 0) {
          return this.claudeAgent.plan(taskDescription, workspacePath, config, onStream, signal, onTokenUsage);
        }
        return this.claudeAgent.plan(taskDescription, workspacePath, config, onStream, signal, onTokenUsage);
      });

      try { await this.artifactService.writeStageArtifact(runDir, '01_plan', planRevision, 'cli_output.jsonl', planOutput); } catch { /* non-fatal */ }
      try { await this.artifactService.writeStageArtifact(runDir, '01_plan', planRevision, 'plan.json', JSON.stringify({ planText: planOutput }, null, 2)); } catch { /* non-fatal */ }

      // Early exit for cannot-proceed
      if (this.detectCannotProceed(planOutput)) {
        return { planOutput, reviewFeedback: '', humanContext: '' };
      }

      // Step 1b: Detect questions in plan output (FR-021)
      if (callbacks.onClarificationNeeded) {
        const questions = this.detectPlanQuestions(planOutput);
        if (questions.length > 0) {
          const answers = await callbacks.onClarificationNeeded(questions);
          // Record clarifications
          for (const q of questions) {
            const a = answers.find((ans) => ans.questionId === q.id);
            if (a) {
              q.answer = a.answer;
              q.answeredAt = new Date().toISOString();
            }
          }
          run.clarifications.push(...questions);

          // Append answers to task description and re-plan
          const answersSection = answers
            .map((a) => {
              const q = questions.find((qq) => qq.id === a.questionId);
              return `Q: ${q?.questionText ?? a.questionId}\nA: ${a.answer}`;
            })
            .join('\n\n');
          taskDescription = `${taskDescription}\n\n## Answers to Agent Questions\n${answersSection}`;

          // Re-run plan with updated context
          planOutput = await this.runStage(run, 'plan', planRevision, runDir, callbacks, async (onStream, onTokenUsage) => {
            return this.claudeAgent.plan(taskDescription, workspacePath, config, onStream, signal, onTokenUsage);
          });
          try { await this.artifactService.writeStageArtifact(runDir, '01_plan', planRevision, 'plan_with_answers.json', JSON.stringify({ planText: planOutput, clarifications: questions }, null, 2)); } catch { /* non-fatal */ }
        }

        // Persist clarification Q&A as a standalone artifact (FR-021 / T117)
        if (run.clarifications.length > 0) {
          try { await this.artifactService.writeStageArtifact(runDir, '01_plan', planRevision, 'clarifications.json', JSON.stringify(run.clarifications, null, 2)); } catch { /* non-fatal */ }
        }
      }

      // Step 2: Codex Review Plan
      this.checkCancelled();
      let reviewOutput = await this.runStage(run, 'review_plan', planRevision, runDir, callbacks, async (onStream, onTokenUsage) => {
        return this.codexAgent.verifyPlan(planOutput, workspacePath, config, onStream, signal, onTokenUsage);
      });

      // Guard against empty review — treat as PASS with a warning
      if (!reviewOutput.trim()) {
        reviewOutput = 'PASS (reviewer returned no output — plan was not reviewed)';
      }

      try { await this.artifactService.writeStageArtifact(runDir, '02_review_plan', planRevision, 'cli_output.jsonl', reviewOutput); } catch { /* non-fatal */ }
      try { await this.artifactService.writeStageArtifact(runDir, '02_review_plan', planRevision, 'review.json', JSON.stringify({ rawOutput: reviewOutput }, null, 2)); } catch { /* non-fatal */ }

      // Step 3: If REVISE, auto-fix plan with Claude
      let reviewFeedback = reviewOutput;
      const needsRevision = reviewOutput.toUpperCase().includes('REVISE');

      if (needsRevision && planRevision < config.maxPlanRevisions) {
        this.checkCancelled();
        const fixedPlan = await this.runStage(run, 'fix_plan', planRevision, runDir, callbacks, async (onStream, onTokenUsage) => {
          return this.claudeAgent.fixPlan(planOutput, reviewOutput, workspacePath, config, onStream, signal, onTokenUsage);
        });

        try { await this.artifactService.writeStageArtifact(runDir, '03_fix_plan', planRevision, 'cli_output.jsonl', fixedPlan); } catch { /* non-fatal */ }

        planOutput = fixedPlan;
        reviewFeedback = `Plan was auto-revised from Codex feedback. Original feedback:\n${reviewOutput}`;
      }

      // Step 4: Human Approval
      this.checkCancelled();

      // Mark human_approval stage as running
      const approvalStage: StageRecord = {
        stageName: 'human_approval',
        stageNumber: STAGE_ORDER.indexOf('human_approval') + 1,
        iteration: planRevision,
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationSeconds: 0,
        cliCommand: null,
        cliExitCode: null,
        error: null,
      };
      run.stages.push(approvalStage);
      try { callbacks.onStageStart('human_approval', planRevision); } catch { /* non-fatal */ }

      const approvalStart = Date.now();
      const approval = await callbacks.onHumanApprovalRequired(planOutput, reviewFeedback);

      approvalStage.durationSeconds = (Date.now() - approvalStart) / 1000;
      approvalStage.endedAt = new Date().toISOString();

      if (approval.decision === 'approve') {
        approvalStage.status = 'completed';
        try { callbacks.onStageComplete('human_approval', planRevision); } catch { /* non-fatal */ }
        return {
          planOutput,
          reviewFeedback,
          humanContext: approval.additionalContext ?? '',
        };
      }

      // Edit & re-plan: loop back
      approvalStage.status = 'completed';
      try { callbacks.onStageComplete('human_approval', planRevision); } catch { /* non-fatal */ }
      this.checkCancelled();
      planRevision++;

      // Append additional context to task for re-plan
      if (approval.additionalContext) {
        taskDescription = `${taskDescription}\n\n## Additional Context from Human Review\n${approval.additionalContext}`;
      }
    }

    // Exhausted all plan revisions — auto-approve last plan to proceed
    return { planOutput, reviewFeedback: '', humanContext: '' };
  }

  private checkCancelled(): void {
    if (this.cancelled) {
      throw new Error('Pipeline cancelled');
    }
  }

  private async runStage(
    run: PipelineRun,
    stageName: StageName,
    iteration: number,
    runDir: string,
    callbacks: PipelineCallbacks,
    execute: (onStream: StreamCallback, onTokenUsage?: TokenUsageCallback) => Promise<string>,
  ): Promise<string> {
    const stageNumber = STAGE_ORDER.indexOf(stageName) + 1;
    const stage: StageRecord = {
      stageName,
      stageNumber,
      iteration,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationSeconds: 0,
      cliCommand: null,
      cliExitCode: null,
      error: null,
    };

    run.stages.push(stage);
    this.currentStageName = stageName;
    try { callbacks.onStageStart(stageName, iteration); } catch { /* callback error must not crash pipeline */ }

    const startTime = Date.now();

    const boundTokenUsage: TokenUsageCallback | undefined = callbacks.onTokenUsage
      ? (usage) => { try { callbacks.onTokenUsage!(stageName, usage); } catch { /* callback error must not crash pipeline */ } }
      : undefined;

    try {
      const result = await execute((text) => {
        try { callbacks.onStream(stageName, text); } catch { /* callback error must not crash pipeline */ }
      }, boundTokenUsage);
      stage.status = 'completed';
      stage.durationSeconds = (Date.now() - startTime) / 1000;
      stage.endedAt = new Date().toISOString();
      try { callbacks.onStageComplete(stageName, iteration); } catch { /* callback error must not crash pipeline */ }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stage.status = 'failed';
      stage.error = message;
      stage.durationSeconds = (Date.now() - startTime) / 1000;
      stage.endedAt = new Date().toISOString();
      try { callbacks.onStageFail(stageName, iteration, message); } catch { /* callback error must not crash pipeline */ }
      throw error;
    }
  }

  private detectPlanQuestions(planOutput: string): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = [];
    for (const line of planOutput.split('\n')) {
      const q = detectQuestions(line, 'claude');
      if (q) questions.push(q);
    }
    return questions;
  }

  private detectCannotProceed(planOutput: string): boolean {
    const upper = planOutput.toUpperCase();
    return upper.includes('CANNOT_PROCEED') ||
      upper.includes('CANNOT PROCEED') ||
      upper.includes('UNABLE TO PROCEED') ||
      upper.includes('AMBIGUOUS REQUIREMENTS') ||
      upper.includes('CONTRADICTORY REQUIREMENTS');
  }

  private buildImplementContext(planOutput: string, reviewFeedback: string): string {
    return [
      '## Plan',
      planOutput,
      '',
      '## Review Feedback',
      reviewFeedback || 'No additional feedback.',
    ].join('\n');
  }

  private buildAuditContext(planOutput: string, diff: string, gateResults: GateResult[]): string {
    const gateSection = gateResults.length > 0
      ? gateResults.map((g) =>
          `### ${g.toolName}: ${g.passed ? 'PASSED' : 'FAILED'} (exit code ${g.exitCode})\n${g.stdout}\n${g.stderr}`
        ).join('\n\n')
      : 'No gates configured.';

    return [
      '## Plan',
      planOutput,
      '',
      '## Implementation Diff',
      diff,
      '',
      '## Gate Results',
      gateSection,
    ].join('\n');
  }

  private buildFixContext(planOutput: string, failedGates: GateResult[], auditOutput: string): string {
    const gateFailures = failedGates.map((g) =>
      `### ${g.toolName} (exit code ${g.exitCode})\n${g.stdout}\n${g.stderr}`
    ).join('\n\n');

    return [
      '## Original Plan',
      planOutput,
      '',
      '## Gate Failures',
      gateFailures || 'All gates passed.',
      '',
      '## Audit Findings',
      auditOutput,
      '',
      '## Instructions',
      'Fix the issues identified above. Only modify files needed to resolve the specific issues.',
    ].join('\n');
  }

  /**
   * Parse the audit verdict from the auditor's output.
   *
   * The auditor may mention "FIX_REQUIRED" in its methodology preamble
   * (e.g. "I'll report a strict PASS/FIX_REQUIRED verdict") which is NOT
   * the actual verdict. We look for the verdict as:
   *   1. A "Verdict: PASS" or "Verdict: FIX_REQUIRED" line (explicit)
   *   2. "FIX_REQUIRED" or "PASS" at the start of a line (standalone verdict)
   * If both are found, the explicit "Verdict:" line wins.
   * Returns true if the audit passed.
   */
  private parseAuditVerdict(auditOutput: string): boolean {
    const lines = auditOutput.split('\n');

    // First pass: look for explicit "Verdict: X" line (strip markdown bold **)
    for (const line of lines) {
      const stripped = line.replace(/\*\*/g, '').trim().toUpperCase();
      if (stripped.startsWith('VERDICT:')) {
        const verdictValue = stripped.slice('VERDICT:'.length).trim();
        if (verdictValue.includes('PASS')) return true;
        if (verdictValue.includes('FIX_REQUIRED')) return false;
      }
    }

    // Second pass: check for standalone verdict at start of a line
    for (const line of lines) {
      const stripped = line.replace(/\*\*/g, '').trim().toUpperCase();
      if (stripped.startsWith('FIX_REQUIRED')) return false;
      if (stripped.startsWith('PASS')) return true;
    }

    // No clear verdict found — default to fail (require explicit PASS)
    return false;
  }

  private buildDocumentContext(
    taskDescription: string,
    planOutput: string,
    reviewFeedback: string,
    humanContext: string,
    diff: string,
    gateResults: GateResult[],
    auditOutput: string,
    clarifications: ClarificationQuestion[],
  ): string {
    const gateSection = gateResults.length > 0
      ? gateResults.map((g) =>
          `### ${g.toolName}: ${g.passed ? 'PASSED' : 'FAILED'} (exit code ${g.exitCode})\n${g.stdout}\n${g.stderr}`
        ).join('\n\n')
      : 'No gates configured.';

    const clarificationSection = clarifications.length > 0
      ? clarifications.map((c) =>
          `Q: ${c.questionText}\nA: ${c.answer ?? '(unanswered)'}`
        ).join('\n\n')
      : 'No clarifications.';

    return [
      '## Task Description',
      taskDescription,
      '',
      '## Plan',
      planOutput,
      '',
      '## Review Feedback',
      reviewFeedback || 'No review feedback.',
      '',
      '## Human Approval Context',
      humanContext || 'No additional human context.',
      '',
      '## Implementation Diff',
      diff || 'No diff captured.',
      '',
      '## Gate Results',
      gateSection,
      '',
      '## Audit Results',
      auditOutput || 'No audit output.',
      '',
      '## Clarifications',
      clarificationSection,
    ].join('\n');
  }

  parseSpecDocOutput(output: string): Map<string, string> {
    const result = new Map<string, string>();
    const marker = /^===FILE:\s*(.+?)\s*===$/;
    const lines = output.split('\n');

    let currentFile: string | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      const match = line.match(marker);
      if (match) {
        // Save previous file if any
        if (currentFile) {
          result.set(currentFile, currentContent.join('\n').trim());
        }
        currentFile = match[1];
        currentContent = [];
      } else if (currentFile) {
        currentContent.push(line);
      }
    }

    // Save last file
    if (currentFile) {
      result.set(currentFile, currentContent.join('\n').trim());
    }

    return result;
  }

}
