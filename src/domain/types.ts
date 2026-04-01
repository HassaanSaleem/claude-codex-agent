// Chat types
export type AgentType = 'claude' | 'codex' | 'workflow';
export type ChatMessageRole = 'user' | 'assistant';
export type ChatMode = 'ask' | 'plan' | 'edit';

export const CHAT_MODES: { key: ChatMode; label: string; description: string }[] = [
  { key: 'ask', label: 'Ask', description: 'Read-only: ask questions, explore code' },
  { key: 'plan', label: 'Plan', description: 'Plan first, then implement with edit access' },
  { key: 'edit', label: 'Edit', description: 'Read-write: make code changes directly' },
];

// Token/cost tracking types (007-token-cost-tracking)
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

// Model pricing (approximate, USD per 1M tokens)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.25, output: 1.25 },
  opus: { input: 15, output: 75 },
  'claude-sonnet-4-5-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
};

export function estimateCost(usage: TokenUsage, model?: string): number {
  const pricing = model ? MODEL_PRICING[model] : undefined;
  if (!pricing) return 0;
  return (usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) / 1_000_000;
}

// Model picker types (008-model-picker)
export interface ModelOption {
  id: string;       // CLI model identifier (e.g., 'haiku', 'sonnet', 'opus')
  label: string;    // Display name
  agent: AgentType; // Which agent this model belongs to
}

export const CLAUDE_MODELS: ModelOption[] = [
  { id: 'sonnet', label: 'Sonnet', agent: 'claude' },
  { id: 'haiku', label: 'Haiku', agent: 'claude' },
  { id: 'opus', label: 'Opus', agent: 'claude' },
];

export const CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', agent: 'codex' },
  { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex', agent: 'codex' },
  { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max', agent: 'codex' },
  { id: 'gpt-5.2', label: 'gpt-5.2', agent: 'codex' },
  { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini', agent: 'codex' },
];

export interface ChatSession {
  id: string;
  title: string;       // First user message, truncated to 40 chars
  createdAt: string;
  agentType: AgentType; // Agent used in this session
  cliSessionId?: string; // Claude CLI session UUID for --resume
  pinnedFiles?: string[]; // Pinned file paths (010-pinned-files)
  mode?: ChatMode;       // Persisted chat mode (ask/plan/edit)
}

export type ChatMessageMetadata =
  | { kind: 'stage_header'; stageName: StageName; iteration: number }
  | { kind: 'approval_request'; planText: string; reviewFeedback: string; responded?: boolean }
  | { kind: 'patch_budget_request'; linesChanged: number; budget: number; responded?: boolean }
  | { kind: 'gate_result'; result: GateResult }
  | { kind: 'workflow_complete'; status: PipelineStatus; summary: string; failedStage?: StageName }
  | { kind: 'clarification_request'; questions: ClarificationQuestion[]; responded?: boolean };

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  agent?: AgentType;
  mode?: ChatMode;
  model?: string;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  metadata?: ChatMessageMetadata;
  fileReferences?: FileReference[];
  thinkingContent?: string;
  tokenUsage?: TokenUsage; // 007-token-cost-tracking
}

// File reference types (003-file-ref-cli-path)
export type FileReferenceStatus = 'resolved' | 'missing' | 'binary' | 'truncated';

export interface FileReference {
  path: string;
  status: FileReferenceStatus;
  isSensitive: boolean;
  size: number | null;
  truncatedAt: number | null;
}

export interface FileAutocompleteEntry {
  relativePath: string;
  fileName: string;
  dirPath: string;
}

// Clarification types (FR-021)
export interface ClarificationQuestion {
  id: string;
  source: 'claude' | 'codex';
  questionText: string;
  detectedVia: 'tool_use' | 'heuristic';
  answer: string | null;
  answeredAt: string | null;
  options?: { label: string; description: string }[];
}

// CLI validation types (FR-024, 002-cli-version-support)
export interface CLIDependency {
  name: string;
  cli: 'claude' | 'codex';
  minVersion: string;
  recommendedVersion: string;
  installCommand: string;
  upgradeCommand: string;
  requiredFlags: string[];
  helpArgs: string[];
}

export interface CLIValidationResult {
  cli: 'claude' | 'codex';
  found: boolean;
  version: string | null;
  minVersion: string;
  valid: boolean;
  versionValid: boolean;
  featuresValid: boolean;
  missingFeatures: string[];
  error: string | null;
  installCommand: string;
}

export interface CLIStatus {
  ready: boolean;
  claude: CLIValidationResult;
  codex: CLIValidationResult;
  lastChecked: number;
}

// Pipeline types
export type PipelineStatus = 'running' | 'passed' | 'failed' | 'cancelled';
export type StageStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type StageName = 'plan' | 'review_plan' | 'fix_plan' | 'human_approval' | 'implement' | 'audit' | 'document';
export type HumanApprovalDecision = 'approve' | 'edit_and_replan';
export type VerificationVerdict = 'pass' | 'revise';
export type AuditVerdict = 'pass' | 'fix_required';
export type IssueSeverity = 'critical' | 'major';
export type DriftSeverity = 'critical' | 'major' | 'minor';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type DriftResolution = 'unresolved' | 'fixed' | 'accepted_with_justification';

export interface PipelineConfig {
  claudeCliPath: string;
  codexCliPath: string;
  claudeModel: string;
  codexModel: string;
  maxIterations: number;
  patchBudget: number;
  testCommand: string;
  lintCommand: string;
  typecheckCommand: string;
  securityScanCommand: string;
  maxPlanRevisions: number;
  cliTimeoutSeconds: number;
  gateTimeoutSeconds: number;
  runDirectory: string;
  pipelineTimeoutSeconds: number;
  runRetentionLimit: number;
}

export interface PipelineRun {
  runId: string;
  taskDescription: string;
  workspacePath: string;
  branchName: string;
  status: PipelineStatus;
  startedAt: string;
  endedAt: string | null;
  iterationCount: number;
  maxIterations: number;
  patchBudget: number;
  finalOutcome: string | null;
  stages: StageRecord[];
  config: PipelineConfig;
  timedOut: boolean;
  activeStageAtTimeout: string | null;
  clarifications: ClarificationQuestion[];
  specFeature?: SpecFeature;
  intermediateState?: {
    planOutput: string;
    reviewFeedback: string;
    humanContext: string;
  };
}

export interface PipelineRunSummary {
  runId: string;
  taskDescription: string;
  status: PipelineStatus;
  startedAt: string;
  endedAt: string | null;
  iterationCount: number;
  runDir?: string;
}

export interface StageRecord {
  stageName: StageName;
  stageNumber: number;
  iteration: number;
  status: StageStatus;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  cliCommand: string | null;
  cliExitCode: number | null;
  error: string | null;
}

export interface Plan {
  version: number;
  taskDescription: string;
  planText: string;
  filesToCreate: string[];
  filesToModify: string[];
  filesToDelete: string[];
  testRequirements: string[];
  verificationStatus: 'pending' | 'passed' | 'revision_required';
}

export interface VerificationResult {
  verdict: VerificationVerdict;
  blockingIssues: BlockingIssue[];
  missingTests: string[];
  suggestions: string[];
  planVersionReviewed: number;
  rawOutput: string;
}

export interface BlockingIssue {
  severity: IssueSeverity;
  description: string;
  planSection: string;
  suggestedFix: string;
}

export interface Implementation {
  planVersion: number;
  iteration: number;
  filesChanged: FileChange[];
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalLinesChanged: number;
  rawOutput: string;
}

export interface FileChange {
  filePath: string;
  changeType: 'created' | 'modified' | 'deleted';
  linesAdded: number;
  linesRemoved: number;
  patch: string;
}

export interface GateResult {
  toolName: string;
  command: string;
  exitCode: number;
  passed: boolean;
  stdout: string;
  stderr: string;
  durationSeconds: number;
  timeoutExceeded: boolean;
}

export interface AuditReport {
  verdict: AuditVerdict;
  iteration: number;
  specDriftItems: DriftItem[];
  riskyCodeFindings: Finding[];
  missingCoverage: string[];
  securityFindings: Finding[];
  requiredChanges: string[];
  rawOutput: string;
}

export interface DriftItem {
  planSection: string;
  expectedBehavior: string;
  actualBehavior: string;
  severity: DriftSeverity;
  resolution: DriftResolution;
  justification: string | null;
}

export interface Finding {
  severity: FindingSeverity;
  filePath: string;
  lineRange: string | null;
  description: string;
  recommendation: string;
}

// Speckit / history types
export interface SpecFeature {
  featureNumber: number;
  featureSlug: string;
  specDir: string;
  taskDescription: string;
}

export type HistoryEntryKind = 'chat_message' | 'stage_event' | 'gate_result' | 'approval' | 'pipeline_status';

export interface HistoryEntry {
  kind: HistoryEntryKind;
  timestamp: string;
  data: Record<string, unknown>;
}

// Webview message types

export type ExtensionMessage =
  | { type: 'streamChunk'; stage: string; text: string }
  | { type: 'stageUpdate'; stage: string; status: StageStatus; message?: string }
  | { type: 'gateResult'; result: GateResult }
  | { type: 'runComplete'; runId: string; status: PipelineStatus; summary: string }
  | { type: 'runHistory'; runs: PipelineRunSummary[] }
  | { type: 'runDetails'; run: PipelineRun }
  | { type: 'confirmPatchBudget'; linesChanged: number; budget: number }
  | { type: 'requestHumanApproval'; planText: string; reviewFeedback: string }
  | { type: 'requestClarification'; questions: ClarificationQuestion[] }
  | { type: 'cliValidationError'; cli: string; found: string | null; required: string }
  | { type: 'cliStatus'; status: CLIStatus }
  | { type: 'error'; message: string; stage?: string }
  // Chat messages
  | { type: 'chatStreamChunk'; messageId: string; text: string }
  | { type: 'chatStreamEnd'; messageId: string; finalText: string }
  | { type: 'chatError'; messageId: string; error: string }
  | { type: 'chatHistory'; messages: ChatMessage[]; mode: ChatMode }
  | { type: 'agentChanged'; agent: AgentType }
  // Workflow messages
  | { type: 'workflowStageStart'; stageName: StageName; iteration: number; messageId: string }
  | { type: 'workflowStreamChunk'; messageId: string; text: string }
  | { type: 'workflowStageEnd'; messageId: string; stageName: StageName }
  | { type: 'workflowGateResult'; messageId: string; result: GateResult }
  | { type: 'workflowRequestApproval'; messageId: string; planText: string; reviewFeedback: string }
  | { type: 'workflowRequestPatchBudget'; messageId: string; linesChanged: number; budget: number }
  | { type: 'workflowRequestClarification'; messageId: string; questions: ClarificationQuestion[] }
  | { type: 'workflowComplete'; status: PipelineStatus; summary: string; failedStage?: StageName }
  | { type: 'workflowError'; error: string }
  // Session messages
  | { type: 'sessionsList'; sessions: ChatSession[]; activeSessionId: string }
  | { type: 'sessionSwitched'; sessionId: string; messages: ChatMessage[]; mode: ChatMode }
  // File reference messages
  | { type: 'fileList'; files: FileAutocompleteEntry[] }
  | { type: 'fileReferencesResolved'; messageId: string; fileReferences: FileReference[] }
  // Thinking messages (004-webview-ux-overhaul)
  | { type: 'chatThinkingChunk'; messageId: string; text: string }
  // Clipboard feedback (004-webview-ux-overhaul)
  | { type: 'copySuccess' }
  // Chat clarification (popup-style questions)
  | { type: 'chatClarificationRequest'; questions: ClarificationQuestion[] }
  // Nuclear workflow reset — forces all running states to false
  | { type: 'workflowReset' }
  // Chat mode messages (005-chat-modes)
  | { type: 'modeChanged'; mode: ChatMode }
  // Model picker messages (008-model-picker)
  | { type: 'modelChanged'; modelId: string }
  // Active editor file (auto-attach)
  | { type: 'activeEditorFile'; path: string | null }
  // Token usage (007-token-cost-tracking)
  | { type: 'chatTokenUsage'; messageId: string; usage: TokenUsage }
  // Pinned files (010-pinned-files)
  | { type: 'pinnedFilesChanged'; pinnedFiles: string[] };

export type WebviewMessage =
  | { type: 'startPipeline'; taskDescription: string }
  | { type: 'cancelPipeline' }
  | { type: 'approvePatchBudget'; approved: boolean }
  | { type: 'humanApproval'; decision: HumanApprovalDecision; additionalContext?: string }
  | { type: 'answerClarification'; answers: { questionId: string; answer: string }[] }
  | { type: 'viewRun'; runId: string }
  | { type: 'viewHistory' }
  | { type: 'createPR'; runId: string }
  // Chat messages
  | { type: 'sendChatMessage'; text: string; fileReferences?: { path: string }[]; skipAutoAttach?: boolean }
  | { type: 'cancelChat' }
  | { type: 'switchAgent'; agent: AgentType }
  | { type: 'requestPipeline'; taskDescription: string; fileReferences?: { path: string }[] }
  | { type: 'requestFileList'; query: string }
  | { type: 'openFile'; path: string }
  | { type: 'getChatHistory' }
  | { type: 'newChat' }
  // Workflow messages
  | { type: 'workflowApproval'; decision: HumanApprovalDecision; additionalContext?: string }
  | { type: 'workflowApprovePatchBudget'; approved: boolean }
  | { type: 'workflowClarificationAnswer'; answers: { questionId: string; answer: string }[] }
  | { type: 'markResponded'; messageId: string }
  | { type: 'cancelWorkflow' }
  // Session messages
  | { type: 'listSessions' }
  | { type: 'switchSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  // Code action messages (004-webview-ux-overhaul)
  | { type: 'copyToClipboard'; text: string }
  | { type: 'insertAtCursor'; text: string }
  // Retry message (004-webview-ux-overhaul)
  | { type: 'retryMessage'; messageId: string }
  // Chat mode messages (005-chat-modes)
  | { type: 'switchMode'; mode: ChatMode }
  // Model picker messages (008-model-picker)
  | { type: 'switchModel'; modelId: string }
  // Pinned files (010-pinned-files)
  | { type: 'pinFile'; path: string }
  | { type: 'unpinFile'; path: string }
  // Session search (011-session-search)
  | { type: 'searchSessions'; query: string }
  // Workflow retry from failed stage
  | { type: 'retryWorkflow' };
