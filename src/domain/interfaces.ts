import type {
  Plan,
  VerificationResult,
  Implementation,
  GateResult,
  AuditReport,
  PipelineRun,
  PipelineRunSummary,
  PipelineConfig,
  StageRecord,
  CLIDependency,
  CLIValidationResult,
  CLIStatus,
  ClarificationQuestion,
  FileAutocompleteEntry,
  FileReference,
  ChatMode,
  TokenUsage,
  SpecFeature,
} from './types.js';

export interface StreamCallback {
  (chunk: string): void;
}

export interface TokenUsageCallback {
  (usage: TokenUsage): void;
}

export interface ClaudeChatOptions {
  message: string;
  workspacePath: string;
  config: PipelineConfig;
  onStream: StreamCallback;
  onThinkingStream?: StreamCallback;
  onQuestionsDetected?: (questions: ClarificationQuestion[]) => void;
  mode?: ChatMode;
  modelOverride?: string;
  onTokenUsage?: TokenUsageCallback;
}

export interface IClaudeAgent {
  plan(taskDescription: string, workspacePath: string, config: PipelineConfig, onStream: StreamCallback, signal?: AbortSignal, onTokenUsage?: TokenUsageCallback): Promise<string>;
  fixPlan(planText: string, reviewFeedback: string, workspacePath: string, config: PipelineConfig, onStream: StreamCallback, signal?: AbortSignal, onTokenUsage?: TokenUsageCallback): Promise<string>;
  implement(context: string, workspacePath: string, config: PipelineConfig, onStream: StreamCallback, signal?: AbortSignal, onTokenUsage?: TokenUsageCallback): Promise<string>;
  chat(options: ClaudeChatOptions): Promise<string>;
  generateSpecDocs(context: string, workspacePath: string, config: PipelineConfig, onStream: StreamCallback, signal?: AbortSignal, onTokenUsage?: TokenUsageCallback): Promise<string>;
  resetSession(): void;
  getCliSessionId(): string | null;
  setCliSessionId(id: string | null): void;
  kill(): void;
}

export interface CodexChatOptions {
  message: string;
  workspacePath: string;
  config: PipelineConfig;
  onStream: StreamCallback;
  mode?: ChatMode;
  modelOverride?: string;
  onTokenUsage?: TokenUsageCallback;
}

export interface ICodexAgent {
  verifyPlan(planText: string, workspacePath: string, config: PipelineConfig, onStream: StreamCallback, signal?: AbortSignal, onTokenUsage?: TokenUsageCallback): Promise<string>;
  audit(planText: string, workspacePath: string, config: PipelineConfig, onStream: StreamCallback, signal?: AbortSignal, onTokenUsage?: TokenUsageCallback): Promise<string>;
  chat(options: CodexChatOptions): Promise<string>;
  resetSession(): void;
  kill(): void;
}

export interface IGateRunner {
  runGates(config: PipelineConfig, workspacePath: string): Promise<GateResult[]>;
}

export interface IArtifactService {
  createRunDirectory(runId: string, workspacePath: string, runDirectory: string): Promise<string>;
  writeStageArtifact(runDir: string, stageName: string, iteration: number, fileName: string, content: string): Promise<void>;
  writeRunManifest(runDir: string, run: PipelineRun): Promise<void>;
  readRunManifest(runDir: string): Promise<PipelineRun>;
  listRuns(workspacePath: string, runDirectory: string): Promise<PipelineRunSummary[]>;
  writeSpecDoc(specDir: string, relativePath: string, content: string): Promise<void>;
}

export interface ISpecService {
  resolveFeatureDirectory(taskDescription: string, workspacePath: string): Promise<SpecFeature>;
}

export interface IRetentionService {
  enforceRetention(workspacePath: string, runDirectory: string, limit: number): Promise<void>;
}

export interface ICLIValidator {
  validateCli(cliPath: string, dependency: CLIDependency): Promise<CLIValidationResult>;
  validateAll(config: PipelineConfig): Promise<CLIStatus>;
  probeFeatures(cliPath: string, requiredFlags: string[], helpArgs?: string[]): Promise<{ valid: boolean; missing: string[] }>;
}

export interface IFileReferenceService {
  listFiles(workspacePath: string, query: string, limit?: number): Promise<FileAutocompleteEntry[]>;
  resolveFileReferences(workspacePath: string, paths: string[]): Promise<{ references: FileReference[]; formattedContext: string }>;
}

export interface IGitService {
  getDiff(workspacePath: string): Promise<string>;
}
