import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { PipelineOrchestrator, type PipelineCallbacks, type PipelineResumeState } from './services/pipelineOrchestrator.js';
import { ChatService } from './services/chatService.js';
import { ChatSessionStore } from './services/chatSessionStore.js';
import { ClaudeAgent } from './infra/claudeAgent.js';
import { CodexAgent } from './infra/codexAgent.js';
import { GateRunnerService } from './services/gateRunnerService.js';
import { ArtifactService } from './services/artifactService.js';
import { GitService } from './services/gitService.js';
import { CLIValidatorService } from './services/cliValidatorService.js';
import { RetentionService } from './services/retentionService.js';
import { FileReferenceService } from './services/fileReferenceService.js';
import { SpecService } from './services/specService.js';
import { HistoryWriter } from './services/historyWriter.js';
import { createPullRequest } from './services/prCreationService.js';
import type { PipelineConfig, ExtensionMessage, WebviewMessage, ChatSession, ChatMessage, CLIStatus, PipelineRun, StageName } from './domain/types.js';
import { CHAT_MODES } from './domain/types.js';
import type { HumanApprovalResponse } from './services/pipelineOrchestrator.js';
import { DEFAULT_CONFIG, WEBVIEW_VIEW_TYPE, WEBVIEW_TITLE, SIDEBAR_VIEW_TYPE, COMMANDS, CLI_DEPENDENCIES } from './domain/constants.js';
import { isLikelyTask } from './utils/taskClassifier.js';

let currentPanel: vscode.WebviewPanel | undefined;
let orchestrator: PipelineOrchestrator | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let lastCLIStatus: CLIStatus | null = null;

function log(message: string) {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('ClaudeCodex');
  }
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

function getConfig(): PipelineConfig {
  const cfg = vscode.workspace.getConfiguration('claudeCodex');
  return {
    claudeCliPath: cfg.get('claudeCliPath', DEFAULT_CONFIG.claudeCliPath),
    codexCliPath: cfg.get('codexCliPath', DEFAULT_CONFIG.codexCliPath),
    claudeModel: cfg.get('claudeModel', DEFAULT_CONFIG.claudeModel),
    codexModel: cfg.get('codexModel', DEFAULT_CONFIG.codexModel),
    maxIterations: cfg.get('maxIterations', DEFAULT_CONFIG.maxIterations),
    patchBudget: cfg.get('patchBudget', DEFAULT_CONFIG.patchBudget),
    testCommand: cfg.get('testCommand', DEFAULT_CONFIG.testCommand),
    lintCommand: cfg.get('lintCommand', DEFAULT_CONFIG.lintCommand),
    typecheckCommand: cfg.get('typecheckCommand', DEFAULT_CONFIG.typecheckCommand),
    securityScanCommand: cfg.get('securityScanCommand', DEFAULT_CONFIG.securityScanCommand),
    maxPlanRevisions: cfg.get('maxPlanRevisions', DEFAULT_CONFIG.maxPlanRevisions),
    cliTimeoutSeconds: cfg.get('cliTimeoutSeconds', DEFAULT_CONFIG.cliTimeoutSeconds),
    gateTimeoutSeconds: cfg.get('gateTimeoutSeconds', DEFAULT_CONFIG.gateTimeoutSeconds),
    runDirectory: cfg.get('runDirectory', DEFAULT_CONFIG.runDirectory),
    pipelineTimeoutSeconds: cfg.get('pipelineTimeout', DEFAULT_CONFIG.pipelineTimeoutSeconds),
    runRetentionLimit: cfg.get('runRetentionLimit', DEFAULT_CONFIG.runRetentionLimit),
  };
}

function getWorkspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error('No workspace folder open. Open a folder before running the pipeline.');
  }
  return folders[0].uri.fsPath;
}

function postToWebview(message: ExtensionMessage) {
  currentPanel?.webview.postMessage(message);
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, mode: 'chat' | 'pipeline' = 'pipeline'): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'),
  );
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>${WEBVIEW_TITLE}</title>
</head>
<body>
  <div id="root" data-mode="${mode}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function createOrShowPanel(context: vscode.ExtensionContext) {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    WEBVIEW_VIEW_TYPE,
    WEBVIEW_TITLE,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    },
  );

  currentPanel.webview.html = getWebviewContent(currentPanel.webview, context.extensionUri, 'pipeline');

  currentPanel.webview.onDidReceiveMessage(
    (message: WebviewMessage) => handleWebviewMessage(message, context),
    undefined,
    context.subscriptions,
  );

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  }, null, context.subscriptions);
}

let patchBudgetResolver: ((approved: boolean) => void) | null = null;
let humanApprovalResolver: ((response: HumanApprovalResponse) => void) | null = null;
let clarificationResolver: ((answers: { questionId: string; answer: string }[]) => void) | null = null;
let lastRunDir: string | null = null;
let lastBranchName: string | null = null;

async function handleWebviewMessage(message: WebviewMessage, context: vscode.ExtensionContext) {
  switch (message.type) {
    case 'startPipeline':
      await runPipeline(message.taskDescription, context);
      break;

    case 'cancelPipeline':
      orchestrator?.cancel();
      break;

    case 'approvePatchBudget':
      patchBudgetResolver?.(message.approved);
      patchBudgetResolver = null;
      break;

    case 'humanApproval':
      humanApprovalResolver?.({
        decision: message.decision,
        additionalContext: message.additionalContext,
      });
      humanApprovalResolver = null;
      break;

    case 'answerClarification':
      clarificationResolver?.(message.answers);
      clarificationResolver = null;
      break;

    case 'createPR': {
      const workspacePath = getWorkspacePath();
      if (!lastRunDir || !lastBranchName) {
        postToWebview({ type: 'error', message: 'No completed run to create PR from.' });
        break;
      }
      const result = await createPullRequest(workspacePath, lastRunDir, lastBranchName);
      if (result.success) {
        vscode.window.showInformationMessage(`PR created: ${result.prUrl}`);
      } else {
        postToWebview({ type: 'error', message: result.error ?? 'Failed to create PR' });
      }
      break;
    }

    case 'viewHistory': {
      const retService = new RetentionService();
      const histConfig = getConfig();
      const histArtifactService = new ArtifactService(retService, histConfig.runRetentionLimit);
      const histWorkspacePath = getWorkspacePath();
      const runs = await histArtifactService.listRuns(histWorkspacePath, histConfig.runDirectory);
      postToWebview({ type: 'runHistory', runs });
      break;
    }

    case 'viewRun': {
      const artifactService = new ArtifactService();
      const workspacePath = getWorkspacePath();
      const config = getConfig();
      const runDir = await artifactService.findRunDir(workspacePath, config.runDirectory, message.runId);
      if (!runDir) {
        postToWebview({ type: 'error', message: `Run ${message.runId} not found.` });
        break;
      }
      try {
        const run = await artifactService.readRunManifest(runDir);
        postToWebview({ type: 'runDetails', run });
      } catch {
        postToWebview({ type: 'error', message: `Run ${message.runId} not found.` });
      }
      break;
    }
  }
}

async function validateClis(config: PipelineConfig): Promise<CLIStatus | null> {
  const validator = new CLIValidatorService();
  try {
    const status = await validator.validateAll(config);
    lastCLIStatus = status;

    if (status.ready) {
      log(`CLI validated: Claude ${status.claude.version}, Codex ${status.codex.version}`);
    } else {
      const failures = [status.claude, status.codex].filter((r) => !r.valid);
      for (const r of failures) {
        if (r.error) {
          log(`CLI validation failed: ${r.error}`);
          const installOrUpgrade = r.found ? 'Upgrade' : 'Install';
          const command = r.found
            ? (r.cli === 'claude' ? CLI_DEPENDENCIES.claude.upgradeCommand : CLI_DEPENDENCIES.codex.upgradeCommand)
            : r.installCommand;
          const action = await vscode.window.showWarningMessage(
            `ClaudeCodex: ${r.cli} — ${r.error}`,
            installOrUpgrade,
            'Open Requirements',
          );
          if (action === installOrUpgrade) {
            const terminal = vscode.window.createTerminal('ClaudeCodex CLI Setup');
            terminal.show();
            terminal.sendText(command);
          } else if (action === 'Open Requirements') {
            const folders = vscode.workspace.workspaceFolders;
            if (folders) {
              const reqFile = vscode.Uri.joinPath(folders[0].uri, 'cli-requirements.md');
              vscode.commands.executeCommand('vscode.open', reqFile);
            }
          }
        }
      }
    }

    return status;
  } catch (error) {
    lastCLIStatus = null;
    log(`CLI validation error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function runPipeline(taskDescription: string, context: vscode.ExtensionContext, fileContext?: string) {
  if (orchestrator) {
    vscode.window.showWarningMessage('A pipeline is already running. Cancel it first or wait for it to complete.');
    return;
  }

  createOrShowPanel(context);

  const config = getConfig();

  let workspacePath: string;
  try {
    workspacePath = getWorkspacePath();
  } catch (error) {
    vscode.window.showWarningMessage('No workspace folder open. Please open a folder before running the pipeline.');
    return;
  }

  if (!lastCLIStatus?.ready) {
    const msg = 'CLI validation failed. Ensure claude and codex CLIs are installed and meet minimum version requirements. Reload the window after installing.';
    log(msg);
    postToWebview({ type: 'error', message: msg });
    vscode.window.showErrorMessage(msg);
    return;
  }

  const claudeAgent = new ClaudeAgent();
  const codexAgent = new CodexAgent();
  const gateRunner = new GateRunnerService();
  const retentionService = new RetentionService();
  const artifactService = new ArtifactService(retentionService, config.runRetentionLimit);
  const gitService = new GitService();
  const specService = new SpecService();
  let pipelineSpecFeature;
  try {
    pipelineSpecFeature = await specService.resolveFeatureDirectory(taskDescription, workspacePath);
  } catch (err) {
    log(`[Pipeline] Failed to create spec directory: ${err instanceof Error ? err.message : String(err)}`);
  }

  orchestrator = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService, retentionService);

  log(`Starting pipeline: "${taskDescription}" in ${workspacePath}`);
  log(`Config: maxIterations=${config.maxIterations}, patchBudget=${config.patchBudget}, claude=${config.claudeCliPath}, codex=${config.codexCliPath}`);

  const callbacks: PipelineCallbacks = {
    onStageStart: (stage, iteration) => {
      log(`Stage ${stage} started (iteration ${iteration})`);
      postToWebview({ type: 'stageUpdate', stage, status: 'running', message: `Iteration ${iteration}` });
    },
    onStageComplete: (stage, iteration) => {
      log(`Stage ${stage} completed (iteration ${iteration})`);
      postToWebview({ type: 'stageUpdate', stage, status: 'completed', message: `Iteration ${iteration}` });
    },
    onStageFail: (stage, iteration, error) => {
      log(`Stage ${stage} failed (iteration ${iteration}): ${error}`);
      postToWebview({ type: 'stageUpdate', stage, status: 'failed', message: error });
    },
    onStream: (stage, text) => {
      postToWebview({ type: 'streamChunk', stage, text });
    },
    onGateResult: (result) => {
      log(`Gate ${result.toolName}: ${result.passed ? 'PASSED' : 'FAILED'} (exit ${result.exitCode}, ${result.durationSeconds.toFixed(1)}s)`);
      postToWebview({ type: 'gateResult', result });
    },
    onPatchBudgetExceeded: (linesChanged, budget) => {
      log(`Patch budget exceeded: ${linesChanged} lines (budget: ${budget})`);
      postToWebview({ type: 'confirmPatchBudget', linesChanged, budget });
      return new Promise<boolean>((resolve) => {
        patchBudgetResolver = resolve;
      });
    },
    onHumanApprovalRequired: (planText, reviewFeedback) => {
      log('Human approval required for plan');
      postToWebview({ type: 'requestHumanApproval', planText, reviewFeedback });
      return new Promise<HumanApprovalResponse>((resolve) => {
        humanApprovalResolver = resolve;
      });
    },
    onClarificationNeeded: (questions) => {
      log(`Clarification needed: ${questions.length} question(s) detected`);
      postToWebview({ type: 'requestClarification', questions });
      return new Promise<{ questionId: string; answer: string }[]>((resolve) => {
        clarificationResolver = resolve;
      });
    },
  };

  // Prepend file reference context to task description for the plan stage
  const enrichedTask = fileContext ? `${fileContext}\n\n${taskDescription}` : taskDescription;
  const run = await orchestrator.run(enrichedTask, workspacePath, config, callbacks, pipelineSpecFeature);

  log(`Pipeline complete: ${run.status} — ${run.finalOutcome ?? 'No outcome'} (${run.stages.length} stages, ${run.iterationCount} iterations)`);

  lastRunDir = run.specFeature?.specDir ?? path.join(workspacePath, config.runDirectory, run.runId);
  lastBranchName = run.branchName;

  postToWebview({
    type: 'runComplete',
    runId: run.runId,
    status: run.status,
    summary: run.finalOutcome ?? 'No outcome',
  });

  orchestrator = undefined;
}

// ── Sidebar Chat Provider ────────────────────────────────────────────

class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private chatService: ChatService;
  private sessionStore: ChatSessionStore | undefined;
  private fileReferenceService: FileReferenceService;
  private extensionContext: vscode.ExtensionContext;
  private initPromise: Promise<void> | null = null;
  private lastActiveEditor: vscode.TextEditor | undefined;

  // Workflow state
  private workflowOrchestrator: PipelineOrchestrator | undefined;
  private workflowClaudeAgent: ClaudeAgent | undefined;
  private workflowCodexAgent: CodexAgent | undefined;
  private workflowApprovalResolver: ((response: HumanApprovalResponse) => void) | null = null;
  private workflowPatchBudgetResolver: ((approved: boolean) => void) | null = null;
  private workflowClarificationResolver: ((answers: { questionId: string; answer: string }[]) => void) | null = null;
  private stageMessageCounter = 0;
  // Retry state
  private lastFailedRun: PipelineRun | undefined;
  private lastWorkflowTaskDescription: string | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    const claudeAgent = new ClaudeAgent();
    const codexAgent = new CodexAgent();
    this.chatService = new ChatService(claudeAgent, codexAgent);
    this.fileReferenceService = new FileReferenceService();
    context.subscriptions.push({ dispose: () => this.fileReferenceService.dispose() });

    // Track the last active text editor for Insert at Cursor + auto-attach
    this.lastActiveEditor = vscode.window.activeTextEditor;
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.lastActiveEditor = editor;
          this.pushActiveEditorFile();
        }
      }),
    );
  }

  /** Lazy-init: create the store once we know the workspace path, load sessions from disk. */
  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    let workspacePath: string;
    try {
      workspacePath = getWorkspacePath();
    } catch {
      log('[ChatInit] No workspace folder — persistence disabled, will retry on next message');
      this.initPromise = null; // Allow retry when workspace is opened
      return;
    }

    const config = getConfig();
    const storeDir = path.join(workspacePath, config.runDirectory, 'chat_sessions');
    log(`[ChatInit] Initializing session store at ${storeDir}`);
    this.sessionStore = new ChatSessionStore(workspacePath, config.runDirectory);

    // Wire up persistence — write to disk on every mutation
    const store = this.sessionStore;
    this.chatService.setPersistFns({
      persistSessions: (sessions) => { store.writeSessions(sessions).catch((e) => log(`[Persist] Failed to write sessions: ${e}`)); },
      persistMessages: (sessionId, messages) => { store.writeMessages(sessionId, messages).catch((e) => log(`[Persist] Failed to write messages for ${sessionId}: ${e}`)); },
      deleteMessages: (sessionId) => { store.deleteSessionDir(sessionId).catch((e) => log(`[Persist] Failed to delete session ${sessionId}: ${e}`)); },
    });

    // Migration: convert old workspaceState single-key format to disk
    const oldHistory = this.extensionContext.workspaceState.get<ChatMessage[]>('claudecodex.chatHistory');
    if (oldHistory && Array.isArray(oldHistory) && oldHistory.length > 0) {
      log(`[ChatInit] Migrating ${oldHistory.length} messages from workspaceState (single-key)`);
      const migrationId = `migrated-${Date.now().toString(36)}`;
      const firstUserMsg = oldHistory.find((m) => m.role === 'user');
      const title = firstUserMsg
        ? firstUserMsg.content.length > 40
          ? firstUserMsg.content.slice(0, 40) + '...'
          : firstUserMsg.content
        : 'Migrated Chat';
      const session: ChatSession = {
        id: migrationId,
        title,
        createdAt: oldHistory[0].timestamp,
        agentType: 'claude',
      };
      const cleaned = oldHistory.map((m) => ({ ...m, isStreaming: false }));

      await store.writeSessions([session]);
      await store.writeMessages(migrationId, cleaned);
      // Remove old workspaceState keys
      this.extensionContext.workspaceState.update('claudecodex.chatHistory', undefined);
      this.extensionContext.workspaceState.update('claudecodex.chatSessions', undefined);

      this.chatService.loadSessions([session]);
      this.chatService.setActiveSessionId(migrationId);
      this.chatService.loadHistory(cleaned);
      log(`[ChatInit] Migration complete — session ${migrationId}, ${cleaned.length} messages`);
      return;
    }

    // Migration: convert workspaceState multi-key format to disk
    const oldSessions = this.extensionContext.workspaceState.get<ChatSession[]>('claudecodex.chatSessions');
    if (oldSessions && Array.isArray(oldSessions) && oldSessions.length > 0) {
      log(`[ChatInit] Migrating ${oldSessions.length} sessions from workspaceState (multi-key)`);
      await store.writeSessions(oldSessions);
      for (const s of oldSessions) {
        const msgs = this.extensionContext.workspaceState.get<ChatMessage[]>(
          `claudecodex.chatMessages.${s.id}`,
        );
        if (msgs && Array.isArray(msgs)) {
          await store.writeMessages(s.id, msgs);
        }
        // Clean up workspaceState key
        this.extensionContext.workspaceState.update(`claudecodex.chatMessages.${s.id}`, undefined);
      }
      this.extensionContext.workspaceState.update('claudecodex.chatSessions', undefined);
    }

    // Load from disk
    const sessions = await store.readSessions();
    log(`[ChatInit] Read ${sessions.length} sessions from disk`);

    // Recover orphaned session directories (messages on disk but not in sessions.json)
    try {
      const fs = await import('node:fs/promises');
      const entries = await fs.readdir(path.join(workspacePath, config.runDirectory, 'chat_sessions'), { withFileTypes: true });
      const knownIds = new Set(sessions.map((s) => s.id));
      for (const entry of entries) {
        if (!entry.isDirectory() || knownIds.has(entry.name)) continue;
        const msgs = await store.readMessages(entry.name);
        if (msgs.length === 0) continue;
        const firstUserMsg = msgs.find((m) => m.role === 'user');
        const title = firstUserMsg
          ? firstUserMsg.content.length > 40
            ? firstUserMsg.content.slice(0, 40) + '...'
            : firstUserMsg.content
          : 'Recovered Chat';
        sessions.unshift({
          id: entry.name,
          title,
          createdAt: msgs[0].timestamp,
          agentType: (firstUserMsg as any)?.agent ?? 'claude',
        });
        log(`[ChatInit] Recovered orphaned session: ${entry.name} ("${title}")`);
      }
      if (sessions.length > knownIds.size) {
        await store.writeSessions(sessions);
      }
    } catch (e) {
      log(`[ChatInit] Orphan recovery skipped: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (sessions.length > 0) {
      this.chatService.loadSessions(sessions);
      const activeId = sessions[0].id;
      const activeSession = sessions[0];
      this.chatService.setActiveSessionId(activeId);
      // Restore persisted mode (default to 'ask' for old sessions without mode)
      this.chatService.setMode(activeSession.mode ?? 'ask');
      const messages = await store.readMessages(activeId);
      const cleaned = messages.map((m) => ({ ...m, isStreaming: false }));
      this.chatService.loadHistory(cleaned);
      // Restore CLI session so follow-up chat resumes the workflow's Claude session
      if (activeSession.cliSessionId) {
        this.chatService.setClaudeCliSessionId(activeSession.cliSessionId);
      }
      log(`[ChatInit] Loaded session ${activeId} with ${cleaned.length} messages, mode: ${activeSession.mode ?? 'ask'}`);
      // Push loaded sessions to the webview so the sidebar shows them immediately
      this.postMessage({ type: 'sessionsList', sessions, activeSessionId: activeId });
      this.postMessage({ type: 'chatHistory', messages: cleaned, mode: this.chatService.getMode() });
      this.postMessage({ type: 'modeChanged', mode: this.chatService.getMode() });
    } else {
      log('[ChatInit] No sessions found on disk');
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionContext.extensionUri, 'dist')],
    };

    // Register message handler BEFORE setting HTML — the webview sends
    // getChatHistory on mount and we must be listening before that fires.
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      this.extensionContext.subscriptions,
    );

    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionContext.extensionUri, 'chat');
  }

  /** Push the active editor's relative path to the webview for the auto-attach indicator. */
  private pushActiveEditorFile(): void {
    const fsPath = this.lastActiveEditor?.document.uri.fsPath;
    if (!fsPath) {
      this.postMessage({ type: 'activeEditorFile', path: null });
      return;
    }
    try {
      const wp = getWorkspacePath();
      const rel = path.relative(wp, fsPath);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        this.postMessage({ type: 'activeEditorFile', path: rel });
      } else {
        this.postMessage({ type: 'activeEditorFile', path: null });
      }
    } catch {
      this.postMessage({ type: 'activeEditorFile', path: null });
    }
  }

  private postMessage(message: ExtensionMessage): void {
    if (!this.view) {
      log(`[postMessage] DROPPED (no view): ${message.type}`);
      return;
    }
    this.view.webview.postMessage(message);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    log(`[handleMessage] Received: ${message.type}`);
    await this.ensureInitialized();

    switch (message.type) {
      case 'sendChatMessage': {
        const agent = this.chatService.getAgent();
        const mode = this.chatService.getMode();
        log(`[sendChatMessage] Agent: ${agent}, Mode: ${mode}, text: "${message.text.slice(0, 80)}..."`);
        const isTask = agent === 'workflow' ? isLikelyTask(message.text) : false;
        if (agent === 'workflow' && !isTask) {
          log(`[sendChatMessage] Workflow triage: non-task message, routing to regular chat`);
        }

        // Resolve file references (shared by both workflow and regular chat paths)
        let workspacePath: string;
        try {
          workspacePath = getWorkspacePath();
        } catch {
          this.postMessage({ type: 'chatError', messageId: '', error: 'No workspace folder open.' });
          return;
        }

        // Auto-attach active editor file (skip if user dismissed)
        const activeFilePath = message.skipAutoAttach ? undefined : this.lastActiveEditor?.document.uri.fsPath;
        log(`[autoAttach] lastActiveEditor fsPath: ${activeFilePath ?? 'none'}${message.skipAutoAttach ? ' (skipped — user dismissed)' : ''}`);
        if (activeFilePath) {
          const rel = path.relative(workspacePath, activeFilePath);
          log(`[autoAttach] relative: "${rel}"`);
          if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
            const refs = message.fileReferences ?? [];
            const alreadyReferenced = refs.some((f) => f.path === rel);
            if (!alreadyReferenced) {
              message.fileReferences = [...refs, { path: rel }];
              log(`[autoAttach] Attached: ${rel}`);
            } else {
              log(`[autoAttach] Already referenced: ${rel}`);
            }
          }
        }

        // Include pinned files (010-pinned-files)
        const pinnedFiles = this.chatService.getPinnedFiles();
        if (pinnedFiles.length > 0) {
          const pinnedRefs = pinnedFiles.map((p) => ({ path: p }));
          const existingRefs = message.fileReferences ?? [];
          const existingPaths = new Set(existingRefs.map((f) => f.path));
          for (const pr of pinnedRefs) {
            if (!existingPaths.has(pr.path)) {
              existingRefs.push(pr);
            }
          }
          message.fileReferences = existingRefs;
        }

        // Resolve file references if present
        let fileContext: string | undefined;
        if (message.fileReferences && message.fileReferences.length > 0) {
          const paths = message.fileReferences.map((f) => f.path);
          const resolved = await this.fileReferenceService.resolveFileReferences(workspacePath, paths);
          log(`File references resolved: ${resolved.references.length} files, ${resolved.references.filter((r) => r.status === 'resolved').length} readable`);
          if (resolved.formattedContext) {
            fileContext = resolved.formattedContext;
          }
          // Post resolved references back to webview for UI display
          const lastUserMsg = this.chatService.getHistory().filter((m) => m.role === 'user').pop();
          if (lastUserMsg) {
            this.postMessage({ type: 'fileReferencesResolved', messageId: lastUserMsg.id, fileReferences: resolved.references });
          }
        }

        if (agent === 'workflow' && isTask) {
          await this.runWorkflowInChat(message.text, fileContext);
        } else {
          let chunkCount = 0;
          const config = getConfig();
          await this.chatService.sendMessage(message.text, workspacePath, config, {
            onStreamChunk: (messageId, text) => {
              chunkCount++;
              if (chunkCount <= 3) log(`[chatStream] Chunk #${chunkCount} for ${messageId}: ${text.slice(0, 60)}...`);
              this.postMessage({ type: 'chatStreamChunk', messageId, text });
            },
            onStreamEnd: (messageId, finalText) => {
              log(`[chatStream] End for ${messageId}: ${chunkCount} chunks, ${finalText.length} chars total`);
              this.postMessage({ type: 'chatStreamEnd', messageId, finalText });
            },
            onError: (messageId, error) => {
              log(`[chatStream] Error for ${messageId}: ${error}`);
              this.postMessage({ type: 'chatError', messageId, error });
            },
            onThinkingChunk: (messageId, text) => {
              this.postMessage({ type: 'chatThinkingChunk', messageId, text });
            },
            onQuestionsDetected: (questions) => {
              log(`[chatStream] Questions detected from AskUserQuestion: ${questions.length}`);
              // Add an inline clarification message to chat history
              this.chatService.addMessage({
                id: `clarify-${Date.now()}`,
                role: 'assistant',
                agent: 'claude',
                content: '',
                timestamp: new Date().toISOString(),
                metadata: { kind: 'clarification_request', questions },
              });
              this.postMessage({ type: 'chatClarificationRequest', questions });
            },
            onTokenUsage: (messageId, usage) => {
              log(`[chatStream] Token usage for ${messageId}: ${usage.inputTokens}in/${usage.outputTokens}out`);
              this.postMessage({ type: 'chatTokenUsage', messageId, usage });
            },
          }, fileContext);
        }
        break;
      }

      case 'requestFileList': {
        let workspacePath: string;
        try {
          workspacePath = getWorkspacePath();
        } catch {
          this.postMessage({ type: 'fileList', files: [] });
          return;
        }
        const files = await this.fileReferenceService.listFiles(workspacePath, message.query);
        this.postMessage({ type: 'fileList', files });
        break;
      }

      case 'openFile': {
        let workspacePath: string;
        try {
          workspacePath = getWorkspacePath();
        } catch {
          return;
        }
        const absolutePath = path.join(workspacePath, message.path);
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(absolutePath));
        break;
      }

      case 'cancelChat':
        this.chatService.cancelActiveChat();
        break;

      case 'cancelWorkflow':
        this.cancelWorkflow();
        break;

      case 'retryWorkflow':
        await this.retryWorkflowFromFailedStage();
        break;

      case 'workflowApproval':
        this.workflowApprovalResolver?.({
          decision: message.decision,
          additionalContext: message.additionalContext,
        });
        this.workflowApprovalResolver = null;
        break;

      case 'workflowApprovePatchBudget':
        this.workflowPatchBudgetResolver?.(message.approved);
        this.workflowPatchBudgetResolver = null;
        break;

      case 'workflowClarificationAnswer':
        this.workflowClarificationResolver?.(message.answers);
        this.workflowClarificationResolver = null;
        break;

      case 'markResponded': {
        // Persist responded=true in message metadata so it survives webview reload
        const msg = this.chatService.getHistory().find((m) => m.id === message.messageId);
        if (msg?.metadata) {
          (msg.metadata as Record<string, unknown>).responded = true;
          this.chatService.updateMessage(message.messageId, { metadata: msg.metadata });
        }
        break;
      }

      case 'switchAgent':
        this.chatService.setAgent(message.agent);
        // Reset model when switching agents (model IDs are agent-specific)
        this.chatService.setModel(null);
        this.postMessage({ type: 'agentChanged', agent: message.agent });
        this.postMessage({ type: 'modeChanged', mode: this.chatService.getMode() });
        this.postMessage({ type: 'modelChanged', modelId: '' });
        break;

      case 'switchMode': {
        const validMode = CHAT_MODES.some((m) => m.key === message.mode);
        if (validMode) {
          this.chatService.setMode(message.mode);
          this.postMessage({ type: 'modeChanged', mode: message.mode });
          log(`[switchMode] Mode changed to: ${message.mode}`);
        }
        break;
      }

      case 'switchModel': {
        this.chatService.setModel(message.modelId || null);
        this.postMessage({ type: 'modelChanged', modelId: message.modelId });
        log(`[switchModel] Model changed to: ${message.modelId || 'default'}`);
        break;
      }

      case 'requestPipeline': {
        createOrShowPanel(this.extensionContext);
        let pipelineFileContext: string | undefined;
        if (message.fileReferences && message.fileReferences.length > 0) {
          try {
            const wp = getWorkspacePath();
            const paths = message.fileReferences.map((f) => f.path);
            const resolved = await this.fileReferenceService.resolveFileReferences(wp, paths);
            if (resolved.formattedContext) {
              pipelineFileContext = resolved.formattedContext;
            }
          } catch {
            // File resolution failure shouldn't block pipeline
          }
        }
        await runPipeline(message.taskDescription, this.extensionContext, pipelineFileContext);
        break;
      }

      case 'getChatHistory': {
        const history = this.chatService.getHistory();
        log(`[getChatHistory] Sending ${history.length} messages, ${this.chatService.getSessions().length} sessions, mode: ${this.chatService.getMode()}`);
        this.postMessage({ type: 'chatHistory', messages: history, mode: this.chatService.getMode() });
        this.postMessage({
          type: 'sessionsList',
          sessions: this.chatService.getSessions(),
          activeSessionId: this.chatService.getActiveSessionId(),
        });
        // Restore persisted mode for current session
        this.postMessage({ type: 'modeChanged', mode: this.chatService.getMode() });
        // Send pinned files for current session
        this.postMessage({ type: 'pinnedFilesChanged', pinnedFiles: this.chatService.getPinnedFiles() });
        // Send current active editor file for auto-attach indicator
        this.pushActiveEditorFile();
        break;
      }

      case 'newChat': {
        this.cancelWorkflow();
        this.chatService.clearHistory();
        this.postMessage({ type: 'chatHistory', messages: [], mode: this.chatService.getMode() });
        this.postMessage({
          type: 'sessionsList',
          sessions: this.chatService.getSessions(),
          activeSessionId: this.chatService.getActiveSessionId(),
        });
        this.postMessage({ type: 'modeChanged', mode: this.chatService.getMode() });
        this.postMessage({ type: 'modelChanged', modelId: this.chatService.getModel() ?? '' });
        this.postMessage({ type: 'pinnedFilesChanged', pinnedFiles: this.chatService.getPinnedFiles() });
        break;
      }

      case 'listSessions':
        this.postMessage({
          type: 'sessionsList',
          sessions: this.chatService.getSessions(),
          activeSessionId: this.chatService.getActiveSessionId(),
        });
        break;

      case 'switchSession': {
        if (this.chatService.getIsStreaming()) {
          log('[switchSession] Blocked — chat is currently streaming');
          break;
        }
        const targetId = message.sessionId;
        const savedMsgs = this.sessionStore
          ? await this.sessionStore.readMessages(targetId)
          : [];
        const targetMessages = savedMsgs.map((m) => ({ ...m, isStreaming: false }));
        this.chatService.switchSession(targetId, targetMessages);
        this.postMessage({ type: 'sessionSwitched', sessionId: targetId, messages: targetMessages, mode: this.chatService.getMode() });
        this.postMessage({ type: 'agentChanged', agent: this.chatService.getAgent() });
        this.postMessage({ type: 'modeChanged', mode: this.chatService.getMode() });
        this.postMessage({ type: 'modelChanged', modelId: this.chatService.getModel() ?? '' });
        this.postMessage({ type: 'pinnedFilesChanged', pinnedFiles: this.chatService.getPinnedFiles() });
        break;
      }

      case 'deleteSession': {
        const result = this.chatService.deleteSession(message.sessionId);
        if (result.switchedTo) {
          // Active session was deleted — load the new active session's messages from disk
          const diskMsgs = this.sessionStore
            ? await this.sessionStore.readMessages(result.switchedTo)
            : [];
          const loadedMsgs = diskMsgs.map((m) => ({ ...m, isStreaming: false }));
          this.chatService.loadHistory(loadedMsgs);
          this.postMessage({ type: 'sessionSwitched', sessionId: result.switchedTo, messages: loadedMsgs, mode: this.chatService.getMode() });
          this.postMessage({ type: 'agentChanged', agent: this.chatService.getAgent() });
          this.postMessage({ type: 'modeChanged', mode: this.chatService.getMode() });
          this.postMessage({ type: 'modelChanged', modelId: this.chatService.getModel() ?? '' });
        }
        this.postMessage({
          type: 'sessionsList',
          sessions: this.chatService.getSessions(),
          activeSessionId: this.chatService.getActiveSessionId(),
        });
        this.postMessage({ type: 'pinnedFilesChanged', pinnedFiles: this.chatService.getPinnedFiles() });
        break;
      }

      case 'renameSession':
        this.chatService.renameSession(message.sessionId, message.title);
        this.postMessage({
          type: 'sessionsList',
          sessions: this.chatService.getSessions(),
          activeSessionId: this.chatService.getActiveSessionId(),
        });
        break;

      // Pinned files (010-pinned-files)
      case 'pinFile': {
        const updated = this.chatService.pinFile(message.path);
        this.postMessage({ type: 'pinnedFilesChanged', pinnedFiles: updated });
        break;
      }

      case 'unpinFile': {
        const updated = this.chatService.unpinFile(message.path);
        this.postMessage({ type: 'pinnedFilesChanged', pinnedFiles: updated });
        break;
      }

      // Session search (011-session-search)
      case 'searchSessions': {
        const results = this.chatService.searchSessions(message.query);
        this.postMessage({
          type: 'sessionsList',
          sessions: results,
          activeSessionId: this.chatService.getActiveSessionId(),
        });
        break;
      }

      // Code action handlers (004-webview-ux-overhaul)
      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        this.postMessage({ type: 'copySuccess' });
        break;

      case 'insertAtCursor': {
        const editor = this.lastActiveEditor;
        if (editor) {
          await editor.edit((eb) => {
            eb.insert(editor.selection.active, message.text);
          });
        } else {
          vscode.window.showWarningMessage('No active editor — open a file first.');
        }
        break;
      }

      // Retry handler (004-webview-ux-overhaul)
      case 'retryMessage': {
        const history = this.chatService.getHistory();
        const assistantIdx = history.findIndex((m) => m.id === message.messageId);
        if (assistantIdx < 0) break;
        // Find the preceding user message
        let userMsg: ChatMessage | undefined;
        for (let ri = assistantIdx - 1; ri >= 0; ri--) {
          if (history[ri].role === 'user') {
            userMsg = history[ri];
            break;
          }
        }
        if (!userMsg) break;
        // Remove the assistant message from history
        this.chatService.removeMessage(message.messageId);
        this.postMessage({ type: 'chatHistory', messages: this.chatService.getHistory(), mode: this.chatService.getMode() });
        // Re-send the user message
        let wp: string;
        try {
          wp = getWorkspacePath();
        } catch {
          this.postMessage({ type: 'chatError', messageId: '', error: 'No workspace folder open.' });
          break;
        }
        const retryConfig = getConfig();
        await this.chatService.sendMessage(userMsg.content, wp, retryConfig, {
          onStreamChunk: (msgId, text) => {
            this.postMessage({ type: 'chatStreamChunk', messageId: msgId, text });
          },
          onStreamEnd: (msgId, finalText) => {
            this.postMessage({ type: 'chatStreamEnd', messageId: msgId, finalText });
          },
          onError: (msgId, error) => {
            this.postMessage({ type: 'chatError', messageId: msgId, error });
          },
          onThinkingChunk: (msgId, text) => {
            this.postMessage({ type: 'chatThinkingChunk', messageId: msgId, text });
          },
          onQuestionsDetected: (questions) => {
            this.chatService.addMessage({
              id: `clarify-${Date.now()}`,
              role: 'assistant',
              agent: 'claude',
              content: '',
              timestamp: new Date().toISOString(),
              metadata: { kind: 'clarification_request', questions },
            });
            this.postMessage({ type: 'chatClarificationRequest', questions });
          },
          onTokenUsage: (msgId, usage) => {
            this.postMessage({ type: 'chatTokenUsage', messageId: msgId, usage });
          },
        });
        break;
      }

      default:
        log(`[handleMessage] Unhandled message type: ${(message as { type: string }).type}`);
        break;
    }
  }

  /** Kill all running agent handles — called from deactivate() */
  killRunningAgents(): void {
    this.chatService.cancelActiveChat();
    this.workflowClaudeAgent?.kill();
    this.workflowCodexAgent?.kill();
    this.workflowOrchestrator?.cancel();
  }

  /** Remove a spec directory if it contains no meaningful artifacts (only empty subdirs). */
  private async cleanupEmptySpecDir(specDir: string): Promise<void> {
    try {
      const fs = await import('node:fs/promises');
      const entries = await fs.readdir(specDir, { withFileTypes: true });
      const hasFiles = entries.some((e) => e.isFile());
      if (!hasFiles) {
        await fs.rm(specDir, { recursive: true, force: true });
        log(`[Workflow] Cleaned up empty spec directory: ${specDir}`);
      }
    } catch {
      // Cleanup failure is non-fatal
    }
  }

  private cancelWorkflow(): void {
    this.workflowOrchestrator?.cancel();
    this.workflowOrchestrator = undefined;
    // Kill any running CLI subprocesses from workflow agents
    this.workflowClaudeAgent?.kill();
    this.workflowCodexAgent?.kill();
    // Unblock any pending resolvers so promises settle (guard against double-call)
    if (this.workflowApprovalResolver) {
      this.workflowApprovalResolver({ decision: 'approve' });
      this.workflowApprovalResolver = null;
    }
    if (this.workflowPatchBudgetResolver) {
      this.workflowPatchBudgetResolver(false);
      this.workflowPatchBudgetResolver = null;
    }
    if (this.workflowClarificationResolver) {
      this.workflowClarificationResolver([]);
      this.workflowClarificationResolver = null;
    }
    // Reset agent/mode so UI doesn't get stuck in workflow state
    this.chatService.setAgent('claude');
    this.chatService.setMode('ask');
  }

  private async runWorkflowInChat(taskDescription: string, fileContext?: string): Promise<void> {
    if (this.workflowOrchestrator) {
      this.postMessage({ type: 'workflowError', error: 'A workflow is already running. Cancel it first.' });
      return;
    }

    let workspacePath: string;
    try {
      workspacePath = getWorkspacePath();
    } catch {
      this.postMessage({ type: 'workflowError', error: 'No workspace folder open.' });
      return;
    }

    const config = getConfig();

    if (!lastCLIStatus?.ready) {
      const msg = 'CLI validation failed. Ensure claude and codex CLIs are installed and meet minimum version requirements. Reload the window after installing.';
      log(msg);
      this.postMessage({ type: 'workflowError', error: msg });
      return;
    }

    // Store user message in history
    const userMsg: import('./domain/types.js').ChatMessage = {
      id: `wf-user-${Date.now()}`,
      role: 'user',
      content: taskDescription,
      timestamp: new Date().toISOString(),
    };
    this.chatService.addMessage(userMsg);

    const claudeAgent = new ClaudeAgent();
    const codexAgent = new CodexAgent();
    this.workflowClaudeAgent = claudeAgent;
    this.workflowCodexAgent = codexAgent;
    const gateRunner = new GateRunnerService();
    const retentionSvc = new RetentionService();
    const artifactService = new ArtifactService(retentionSvc, config.runRetentionLimit);
    const gitService = new GitService();
    const specService = new SpecService();

    // Resolve feature directory once — shared between history writer and orchestrator
    let historyWriter: HistoryWriter | undefined;
    let workflowSpecFeature: import('./domain/types.js').SpecFeature | undefined;
    try {
      workflowSpecFeature = await specService.resolveFeatureDirectory(taskDescription, workspacePath);
      historyWriter = new HistoryWriter(workflowSpecFeature.specDir);
      log(`[Workflow] Spec directory: ${workflowSpecFeature.specDir}`);
    } catch (err) {
      log(`[Workflow] Failed to create spec directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.workflowOrchestrator = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService, retentionSvc);
    this.stageMessageCounter = 0;

    // Prepend file context so the pipeline's plan stage sees attached/pinned files
    if (fileContext) {
      taskDescription = `${fileContext}\n\n${taskDescription}`;
      log('[Workflow] Prepended file context to task description');
    }

    // Prepend chat history so the pipeline's plan stage has context from prior conversation
    const historyContext = this.chatService.buildFullHistoryContext();
    if (historyContext) {
      taskDescription = `${historyContext}\n\n## Task\n${taskDescription}`;
      log('[Workflow] Prepended chat history context to task description');
    }

    log(`Starting workflow in chat: "${taskDescription.slice(0, 200)}" in ${workspacePath}`);

    // Write user message to history
    historyWriter?.append({
      kind: 'chat_message',
      timestamp: new Date().toISOString(),
      data: { role: 'user', content: taskDescription },
    });

    const { callbacks } = this.buildWorkflowCallbacks(historyWriter);

    try {
      const run = await this.workflowOrchestrator.run(taskDescription, workspacePath, config, callbacks, workflowSpecFeature);
      this.handleWorkflowRunComplete(run, historyWriter, claudeAgent, workflowSpecFeature);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`[Workflow] Error: ${errorMsg}`);
      this.postMessage({ type: 'workflowError', error: errorMsg });
      // Clean up orphan spec directory if pipeline failed before producing artifacts
      if (workflowSpecFeature) {
        this.cleanupEmptySpecDir(workflowSpecFeature.specDir);
      }
    } finally {
      this.cleanupWorkflowState(claudeAgent);
    }
  }
  private buildWorkflowCallbacks(historyWriter?: HistoryWriter): {
    callbacks: PipelineCallbacks;
    stageMessageIds: Map<string, string>;
  } {
    const stageMessageIds = new Map<string, string>();
    const stageTexts = new Map<string, string>();

    const callbacks: PipelineCallbacks = {
      onStageStart: (stage, iteration) => {
        const msgId = `wf-stage-${++this.stageMessageCounter}`;
        stageMessageIds.set(stage, msgId);
        stageTexts.set(msgId, '');
        log(`[Workflow] Stage ${stage} started (iteration ${iteration})`);
        historyWriter?.append({
          kind: 'stage_event',
          timestamp: new Date().toISOString(),
          data: { event: 'start', stageName: stage, iteration },
        });
        this.chatService.addMessage({
          id: msgId,
          role: 'assistant',
          agent: 'workflow',
          content: '',
          timestamp: new Date().toISOString(),
          isStreaming: true,
          metadata: { kind: 'stage_header', stageName: stage, iteration },
        });
        this.postMessage({ type: 'workflowStageStart', stageName: stage, iteration, messageId: msgId });
      },
      onStageComplete: (stage, _iteration) => {
        const msgId = stageMessageIds.get(stage) ?? '';
        log(`[Workflow] Stage ${stage} completed`);
        historyWriter?.append({
          kind: 'stage_event',
          timestamp: new Date().toISOString(),
          data: { event: 'complete', stageName: stage },
        });
        this.chatService.updateMessage(msgId, {
          content: stageTexts.get(msgId) ?? '',
          isStreaming: false,
        });
        this.postMessage({ type: 'workflowStageEnd', messageId: msgId, stageName: stage });
      },
      onStageFail: (stage, _iteration, error) => {
        const msgId = stageMessageIds.get(stage) ?? '';
        log(`[Workflow] Stage ${stage} failed: ${error}`);
        historyWriter?.append({
          kind: 'stage_event',
          timestamp: new Date().toISOString(),
          data: { event: 'fail', stageName: stage, error },
        });
        this.chatService.updateMessage(msgId, {
          content: stageTexts.get(msgId) ?? '',
          isStreaming: false,
        });
        this.postMessage({ type: 'workflowStageEnd', messageId: msgId, stageName: stage });
      },
      onStream: (stage, text) => {
        const msgId = stageMessageIds.get(stage);
        if (msgId) {
          const accumulated = (stageTexts.get(msgId) ?? '') + text;
          stageTexts.set(msgId, accumulated);
          this.chatService.updateMessage(msgId, { content: accumulated });
          this.postMessage({ type: 'workflowStreamChunk', messageId: msgId, text });
        }
      },
      onGateResult: (result) => {
        const msgId = `wf-gate-${++this.stageMessageCounter}`;
        log(`[Workflow] Gate ${result.toolName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
        historyWriter?.append({
          kind: 'gate_result',
          timestamp: new Date().toISOString(),
          data: { toolName: result.toolName, passed: result.passed, exitCode: result.exitCode },
        });
        this.chatService.addMessage({
          id: msgId,
          role: 'assistant',
          agent: 'workflow',
          content: '',
          timestamp: new Date().toISOString(),
          metadata: { kind: 'gate_result', result },
        });
        this.postMessage({ type: 'workflowGateResult', messageId: msgId, result });
      },
      onPatchBudgetExceeded: (linesChanged, budget) => {
        const msgId = `wf-budget-${++this.stageMessageCounter}`;
        log(`[Workflow] Patch budget exceeded: ${linesChanged}/${budget}`);
        this.chatService.addMessage({
          id: msgId,
          role: 'assistant',
          agent: 'workflow',
          content: '',
          timestamp: new Date().toISOString(),
          metadata: { kind: 'patch_budget_request', linesChanged, budget },
        });
        this.postMessage({ type: 'workflowRequestPatchBudget', messageId: msgId, linesChanged, budget });
        return new Promise<boolean>((resolve) => {
          this.workflowPatchBudgetResolver = resolve;
        });
      },
      onHumanApprovalRequired: (planText, reviewFeedback) => {
        const msgId = `wf-approval-${++this.stageMessageCounter}`;
        log('[Workflow] Human approval required');
        historyWriter?.append({
          kind: 'approval',
          timestamp: new Date().toISOString(),
          data: { event: 'requested' },
        });
        this.chatService.addMessage({
          id: msgId,
          role: 'assistant',
          agent: 'workflow',
          content: '',
          timestamp: new Date().toISOString(),
          metadata: { kind: 'approval_request', planText, reviewFeedback },
        });
        this.postMessage({ type: 'workflowRequestApproval', messageId: msgId, planText, reviewFeedback });
        return new Promise<HumanApprovalResponse>((resolve) => {
          this.workflowApprovalResolver = resolve;
        });
      },
      onClarificationNeeded: (questions) => {
        const msgId = `wf-clarify-${++this.stageMessageCounter}`;
        log(`[Workflow] Clarification needed: ${questions.length} question(s)`);
        this.chatService.addMessage({
          id: msgId,
          role: 'assistant',
          agent: 'workflow',
          content: '',
          timestamp: new Date().toISOString(),
          metadata: { kind: 'clarification_request', questions },
        });
        this.postMessage({ type: 'workflowRequestClarification', messageId: msgId, questions });
        return new Promise<{ questionId: string; answer: string }[]>((resolve) => {
          this.workflowClarificationResolver = resolve;
        });
      },
      onTokenUsage: (stage, usage) => {
        const msgId = stageMessageIds.get(stage);
        if (msgId) {
          log(`[chatStream] Token usage for ${msgId}: ${usage.inputTokens}in/${usage.outputTokens}out`);
          this.chatService.updateMessage(msgId, { tokenUsage: usage });
          this.postMessage({ type: 'chatTokenUsage', messageId: msgId, usage });
        }
      },
    };

    return { callbacks, stageMessageIds };
  }

  private handleWorkflowRunComplete(
    run: PipelineRun,
    historyWriter: HistoryWriter | undefined,
    claudeAgent: ClaudeAgent,
    workflowSpecFeature?: import('./domain/types.js').SpecFeature,
  ): void {
    log(`[Workflow] Complete: ${run.status} — ${run.finalOutcome ?? 'No outcome'}`);
    historyWriter?.append({
      kind: 'pipeline_status',
      timestamp: new Date().toISOString(),
      data: { status: run.status, finalOutcome: run.finalOutcome },
    });

    // Determine the failed stage for retry
    let failedStage: StageName | undefined;
    if (run.status === 'failed' || run.status === 'cancelled') {
      this.lastFailedRun = run;
      this.lastWorkflowTaskDescription = run.taskDescription;
      // Use activeStageAtTimeout if available (timeout case), otherwise find last failed stage
      if (run.activeStageAtTimeout) {
        failedStage = run.activeStageAtTimeout as StageName;
      } else {
        const failedRecord = [...run.stages].reverse().find((s) => s.status === 'failed');
        failedStage = failedRecord?.stageName;
      }
    } else {
      // Clear retry state on success
      this.lastFailedRun = undefined;
      this.lastWorkflowTaskDescription = undefined;
    }

    const completeMsg: ChatMessage = {
      id: `wf-complete-${Date.now()}`,
      role: 'assistant',
      agent: 'workflow',
      content: '',
      timestamp: new Date().toISOString(),
      metadata: { kind: 'workflow_complete', status: run.status, summary: run.finalOutcome ?? 'No outcome', failedStage },
    };
    this.chatService.addMessage(completeMsg);

    this.postMessage({
      type: 'workflowComplete',
      status: run.status,
      summary: run.finalOutcome ?? 'No outcome',
      failedStage,
    });
  }

  private cleanupWorkflowState(claudeAgent: ClaudeAgent): void {
    // Transfer workflow's Claude session to chat so --resume gives full context
    const workflowSessionId = claudeAgent.getCliSessionId();
    if (workflowSessionId) {
      this.chatService.setClaudeCliSessionId(workflowSessionId);
      log(`[Workflow] Transferred CLI session ${workflowSessionId} to chat`);
    }
    this.workflowOrchestrator = undefined;
    this.workflowClaudeAgent = undefined;
    this.workflowCodexAgent = undefined;
    // Nuclear reset: unconditionally force the webview out of any running state.
    this.postMessage({ type: 'workflowReset' });
    log('[Workflow] Sent workflowReset (finally block)');
  }

  private async retryWorkflowFromFailedStage(): Promise<void> {
    if (!this.lastFailedRun?.intermediateState) {
      this.postMessage({ type: 'workflowError', error: 'No failed workflow to retry. Run a workflow first.' });
      return;
    }

    if (this.workflowOrchestrator) {
      this.postMessage({ type: 'workflowError', error: 'A workflow is already running. Cancel it first.' });
      return;
    }

    let workspacePath: string;
    try {
      workspacePath = getWorkspacePath();
    } catch {
      this.postMessage({ type: 'workflowError', error: 'No workspace folder open.' });
      return;
    }

    const config = getConfig();

    if (!lastCLIStatus?.ready) {
      this.postMessage({ type: 'workflowError', error: 'CLI validation failed. Ensure CLIs are installed.' });
      return;
    }

    const failedRun = this.lastFailedRun;
    const taskDescription = this.lastWorkflowTaskDescription ?? failedRun.taskDescription;

    // Determine resume stage from the failed run
    const failedStageName = (failedRun.activeStageAtTimeout
      ?? [...failedRun.stages].reverse().find((s) => s.status === 'failed')?.stageName
      ?? 'implement') as StageName;

    let resumeFromStage: 'implement' | 'audit' | 'document';
    if (failedStageName === 'document') {
      resumeFromStage = 'document';
    } else if (failedStageName === 'audit') {
      resumeFromStage = 'audit';
    } else {
      resumeFromStage = 'implement';
    }

    log(`[Workflow Retry] Resuming from stage: ${resumeFromStage} (failed at: ${failedStageName})`);

    // Add retry user message
    const userMsg: ChatMessage = {
      id: `wf-retry-${Date.now()}`,
      role: 'user',
      content: `Retrying workflow from ${resumeFromStage} stage...`,
      timestamp: new Date().toISOString(),
    };
    this.chatService.addMessage(userMsg);

    // Create fresh agents
    const claudeAgent = new ClaudeAgent();
    const codexAgent = new CodexAgent();
    this.workflowClaudeAgent = claudeAgent;
    this.workflowCodexAgent = codexAgent;

    // Restore CLI session so --resume gives Claude full context
    const activeSession = this.chatService.getSessions().find(
      (s) => s.id === this.chatService.getActiveSessionId(),
    );
    if (activeSession?.cliSessionId) {
      claudeAgent.setCliSessionId(activeSession.cliSessionId);
      log(`[Workflow Retry] Restored CLI session: ${activeSession.cliSessionId}`);
    }

    const gateRunner = new GateRunnerService();
    const retentionSvc = new RetentionService();
    const artifactService = new ArtifactService(retentionSvc, config.runRetentionLimit);
    const gitService = new GitService();

    this.workflowOrchestrator = new PipelineOrchestrator(claudeAgent, codexAgent, gateRunner, artifactService, gitService, retentionSvc);
    this.stageMessageCounter = 0;

    const resumeState: PipelineResumeState = {
      planOutput: failedRun.intermediateState!.planOutput,
      reviewFeedback: failedRun.intermediateState!.reviewFeedback,
      humanContext: failedRun.intermediateState!.humanContext,
      resumeFromStage,
      iteration: failedRun.iterationCount,
    };

    const { callbacks } = this.buildWorkflowCallbacks();

    try {
      const run = await this.workflowOrchestrator.run(
        taskDescription, workspacePath, config, callbacks,
        failedRun.specFeature, resumeState,
      );
      this.handleWorkflowRunComplete(run, undefined, claudeAgent, failedRun.specFeature);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`[Workflow Retry] Error: ${errorMsg}`);
      this.postMessage({ type: 'workflowError', error: errorMsg });
    } finally {
      this.cleanupWorkflowState(claudeAgent);
    }
  }
}

let chatViewProvider: ChatViewProvider | undefined;

function sendCLIStatusToWebview(status: CLIStatus): void {
  postToWebview({ type: 'cliStatus', status });
}

export function activate(context: vscode.ExtensionContext) {
  // Validate CLIs on activation (async, non-blocking)
  validateClis(getConfig()).then((status) => {
    if (status) { sendCLIStatusToWebview(status); }
  });

  // Re-validate CLIs when relevant settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeCodex.claudeCliPath') || e.affectsConfiguration('claudeCodex.codexCliPath')) {
        log('CLI path settings changed — re-validating');
        validateClis(getConfig()).then((status) => {
          if (status) { sendCLIStatusToWebview(status); }
        });
      }
    }),
  );

  // Register sidebar chat view
  chatViewProvider = new ChatViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_TYPE, chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.START_PIPELINE, () => {
      createOrShowPanel(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.CANCEL_PIPELINE, () => {
      orchestrator?.cancel();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.VIEW_HISTORY, async () => {
      createOrShowPanel(context);
      const cfg = getConfig();
      const as = new ArtifactService(new RetentionService(), cfg.runRetentionLimit);
      const workspacePath = getWorkspacePath();
      const runs = await as.listRuns(workspacePath, cfg.runDirectory);
      postToWebview({ type: 'runHistory', runs });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.VIEW_RUN, async (runId: string) => {
      createOrShowPanel(context);
      const artifactService = new ArtifactService();
      const workspacePath = getWorkspacePath();
      const config = getConfig();
      const runDir = await artifactService.findRunDir(workspacePath, config.runDirectory, runId);
      if (!runDir) {
        postToWebview({ type: 'error', message: `Run ${runId} not found.` });
        return;
      }
      try {
        const run = await artifactService.readRunManifest(runDir);
        postToWebview({ type: 'runDetails', run });
      } catch {
        postToWebview({ type: 'error', message: `Run ${runId} not found.` });
      }
    }),
  );
}

export function deactivate() {
  orchestrator?.cancel();
  // Kill any running workflow CLI subprocesses via the sidebar provider
  chatViewProvider?.killRunningAgents();
  currentPanel?.dispose();
  outputChannel?.dispose();
  currentPanel = undefined;
  orchestrator = undefined;
  outputChannel = undefined;
  chatViewProvider = undefined;
}
