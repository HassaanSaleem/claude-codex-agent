# claude-codex-agent Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-19

## Active Technologies
- TypeScript 5.6+ (strict mode), Node.js >= 20 LTS + VS Code Extension API (^1.105.0), React 18.3 (Webview UI), Zod 3.23 (validation), esbuild (bundler) (001-dual-vendor-pipeline)
- File-based JSON artifacts in workspace `specs/` directory (no database); chat sessions in `.claudecodex/sessions/` within workspace (001-dual-vendor-pipeline)
- TypeScript 5.6+ (strict mode) + VS Code Extension API (^1.105.0), Zod 3.23, React 18.3 (002-cli-version-support)
- File-based (no database) (002-cli-version-support)
- TypeScript 5.6+ (strict mode), Node.js >= 20 LTS + VS Code Extension API (^1.105.0), React 18.3 (Webview UI), esbuild (bundler) (003-file-ref-cli-path)
- File references stored as part of ChatMessage JSON in session persistence (`.claudecodex/sessions/`) (003-file-ref-cli-path)
- TypeScript 5.6+ (strict mode), React 18.3, Node.js >= 20 LTS + react-markdown ^10.1.0, remark-gfm ^4.0.1, @shikijs/core, @shikijs/engine-javascript, @shikijs/themes, @shikijs/langs, VS Code Extension API ^1.105.0, Zod 3.23, esbuild 0.24 (004-webview-ux-overhaul)
- N/A (no new storage; existing file-based sessions unchanged) (004-webview-ux-overhaul)
- TypeScript 5.6+ (strict mode), React 18.3, Node.js >= 20 LTS + VS Code Extension API ^1.105.0, Zod 3.23, esbuild 0.24 (005-chat-modes)
- File-based sessions in `.claudecodex/sessions/` (existing; mode persisted across session switches) (005-chat-modes)
- Unified CLI session via `--resume` shared between chat and workflow; no new storage dependencies (013-unified-chat-context)

## Project Structure

```text
src/
├── extension.ts              # Composition root
├── domain/                   # Types, interfaces, constants
├── services/                 # Business logic (orchestration, artifacts, git, chat, retention)
├── infra/                    # CLI wrappers (claude, codex, subprocess)
├── webview/                  # React UI (chat, pipeline, components)
└── utils/                    # Parsers, helpers

test/
├── unit/                     # Vitest
└── integration/              # @vscode/test-cli
```

## Commands

```bash
npm run compile       # Build extension + webview
npm run watch         # Watch mode
npm run check-types   # TypeScript type check
npm run test:unit     # Vitest unit tests
npm run test:integration  # VS Code integration tests
npm run package       # Build .vsix
```

## Code Style

TypeScript 5.6+ strict mode. Async/await for all I/O. Zod for runtime validation. VS Code Output Channel for logging.

## Features

- **001-dual-vendor-pipeline**: Spec-driven development pipeline with Plan → Implement → Audit → Review → Docs stages; dual-vendor support (Claude CLI + Codex CLI); file-based JSON artifacts in workspace `specs/` directory
- **002-cli-version-support**: CLI version detection and compatibility layer for Claude/Codex CLI argument differences across versions
- **003-file-ref-cli-path**: File referencing with `@` trigger, autocomplete, visual file tags, click-to-open; file references stored in ChatMessage JSON
- **004-webview-ux-overhaul**: Rich markdown rendering (react-markdown + Shiki syntax highlighting), code block copy/insert/diff actions, VS Code theme token integration, message actions, auto-scroll, thinking sections, agent badges, inline clarification questions, nuclear workflow reset
- **005-chat-modes**: Ask / Edit / Workflow chat modes with mode-specific CLI flags and UI behavior; mode persists across session switches
- **012-workflow-triage-autoscroll**: Pre-pipeline triage for non-task messages in Workflow mode (`isLikelyTask` heuristic routes to chat instead of pipeline); auto-scroll fix with React-driven `scrollTrigger` + rAF batching
- **013-unified-chat-context**: Chat and workflow share the same Claude CLI session (`--resume`) so context flows implicitly; workflow completion surfaces audit verdict, review feedback, gate results; session-scoped with no bleed between sessions
- **014-named-sessions-permission-denials** (in progress): Named CLI sessions via `--name` for discoverability in `claude /resume`; permission denial tracking parsed from CLI result events and surfaced in audit view + chat
- **runtime-hardening-1**: Line buffering, error boundaries, non-fatal artifacts, safer process kills
- **runtime-hardening-2**: Token usage tracking (`onTokenUsage` callbacks through all pipeline stages), renamed run directory `runs/` → `specs/`, plan mode hardening (`permissionMode:'plan'`, no-write instructions), `findRunDir` for nested spec directory lookup, chat history context prepended on workflow switch, retention filtering to NNN-slug dirs only, `runDir` in PipelineRunSummary
- **Workflow retry**: Completion message shows "Retry from [stage]" button, resumes pipeline from failed stage using saved intermediate state
- **Session continuity for plan/fixPlan**: Plan and fixPlan participate in CLI session chain via `ensureSessionArgs()`; exploration context carries through to implement, docs, and follow-up chat; persisted `cliSessionId` restored on extension startup
- **File references in workflow pipeline**: File resolution (auto-attach, pinned, @-refs) runs before workflow/chat split; `fileContext` prepended to task description before Plan stage
- **Timeout/effort tuning**: Pipeline timeout 3600s, CLI timeout default 1200s, effort/reasoning set to medium for both Claude and Codex CLI agents

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
