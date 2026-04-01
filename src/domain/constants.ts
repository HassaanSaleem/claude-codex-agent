import type { PipelineConfig, StageName, CLIDependency } from './types.js';

export const DEFAULT_CONFIG: PipelineConfig = {
  claudeCliPath: 'claude',
  codexCliPath: 'codex',
  claudeModel: '',
  codexModel: '',
  maxIterations: 3,
  patchBudget: 500,
  testCommand: '',
  lintCommand: '',
  typecheckCommand: '',
  securityScanCommand: '',
  maxPlanRevisions: 2,
  cliTimeoutSeconds: 3600,
  gateTimeoutSeconds: 300,
  runDirectory: 'specs',
  pipelineTimeoutSeconds: 3600,
  runRetentionLimit: 20,
};

export const STAGE_ORDER: StageName[] = [
  'plan',
  'review_plan',
  'fix_plan',
  'human_approval',
  'implement',
  'audit',
  'document',
];

export const STAGE_LABELS: Record<StageName, string> = {
  plan: 'Plan',
  review_plan: 'Review Plan',
  fix_plan: 'Fix Plan',
  human_approval: 'Approval',
  implement: 'Implement',
  audit: 'Audit',
  document: 'Document',
};

export const EXIT_CODES = {
  SUCCESS: 0,
  CLI_NOT_FOUND: 127,
  TIMEOUT: 124,
} as const;

/**
 * Heuristic patterns to detect clarifying questions in Codex CLI text output.
 * Each regex matches a question-like sentence ending with '?'.
 */
export const QUESTION_HEURISTIC_PATTERNS: RegExp[] = [
  /\b(?:Should I|Would you|Do you want|Which|What|How should|Can you clarify|Could you|Is it|Are there|Do we)\b[^?]*\?/i,
  /\b(?:QUESTION|CLARIFICATION NEEDED|Please clarify)\s*:?\s*.+\?/i,
];

export const CLI_DEPENDENCIES: Record<'claude' | 'codex', CLIDependency> = {
  claude: {
    name: 'Claude Code CLI',
    cli: 'claude',
    minVersion: '1.0.0',
    recommendedVersion: '2.0.0',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    upgradeCommand: 'npm install -g @anthropic-ai/claude-code@latest',
    requiredFlags: ['--print', '--verbose', '--output-format', '--include-partial-messages', '--append-system-prompt', '--allowedTools'],
    helpArgs: ['--help'],
  },
  codex: {
    name: 'Codex CLI',
    cli: 'codex',
    minVersion: '0.1.0',
    recommendedVersion: '0.1.0',
    installCommand: 'npm install -g @openai/codex',
    upgradeCommand: 'npm install -g @openai/codex@latest',
    requiredFlags: ['--json', '--full-auto', '--sandbox', '-C'],
    helpArgs: ['exec', '--help'],
  },
};

// File reference constants (003-file-ref-cli-path)
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.mp4', '.mov', '.avi',
  '.mp3', '.wav',
  '.pdf',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.o', '.pyc', '.class', '.jar',
  '.woff', '.woff2', '.ttf', '.eot',
]);

export const SENSITIVE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'credentials.json',
  '*secret*',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
];

export const EXCLUDED_DIRS = '{node_modules,dist,build,out,.git,.vscode,.next,.nuxt,coverage,__pycache__}/**';

export const MAX_FILE_SIZE = 102_400; // 100KB

export const SPECKIT_SYSTEM_PROMPT = `You are a technical documentation generator. You will receive the complete output from a software development pipeline (task description, plan, review, implementation diff, audit results, clarifications).

CRITICAL: Do NOT use Write, Edit, or Bash tools to create files. You do not have permission and must not attempt it. Instead, output ALL file content directly in your response using the marker format below. The caller will parse your output and write the files.

Generate speckit documentation. Output each file using this exact marker format:

===FILE: spec.md===
[content]

===FILE: plan.md===
[content]

===FILE: tasks.md===
[content]

===FILE: data-model.md===
[content]

===FILE: research.md===
[content]

===FILE: checklists/requirements.md===
[content]

Follow the speckit format: spec.md has user stories + FRs + success criteria, plan.md has technical decisions + project structure, tasks.md has phased task breakdown, data-model.md has relevant data structures, research.md has research notes and alternatives considered. Base all content strictly on the pipeline data provided. Mark all tasks as [X] (completed) since the implementation is done. Only include files that have meaningful content based on the pipeline data — skip files that would be empty or redundant.`;

export const WEBVIEW_VIEW_TYPE = 'claudeCodex.pipelinePanel';
export const WEBVIEW_TITLE = 'ClaudeCodex Pipeline';
export const SIDEBAR_VIEW_TYPE = 'claudeCodex.chatView';

export const COMMANDS = {
  START_PIPELINE: 'claudeCodex.startPipeline',
  CANCEL_PIPELINE: 'claudeCodex.cancelPipeline',
  VIEW_HISTORY: 'claudeCodex.viewHistory',
  VIEW_RUN: 'claudeCodex.viewRun',
} as const;
