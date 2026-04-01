# CLI Requirements

This extension requires two CLI tools to be installed globally. The table below lists the minimum and recommended versions.

| CLI | npm Package | Minimum Version | Recommended Version | Install Command |
|-----|-------------|-----------------|---------------------|-----------------|
| Claude Code CLI | `@anthropic-ai/claude-code` | 1.0.0 | 2.0.0 | `npm install -g @anthropic-ai/claude-code` |
| Codex CLI | `@openai/codex` | 0.1.0 | 0.1.0 | `npm install -g @openai/codex` |

## Install / Upgrade

```bash
# Install both CLIs
npm install -g @anthropic-ai/claude-code @openai/codex

# Or upgrade to the latest versions
npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest
```

## Verify Installation

After installing, verify the CLIs are available and meet the minimum version:

```bash
claude --version   # Should output >= 1.0.0
codex --version    # Should output >= 0.1.0
```

If either command is not found or reports a version below the minimum, install or upgrade using the commands above, then reload the VS Code window.

## Required CLI Features

The extension validates that each CLI supports the flags it needs at startup:

- **Claude Code CLI**: `--print`, `--verbose`, `--output-format`, `--include-partial-messages`, `--append-system-prompt`, `--allowedTools`
- **Codex CLI**: `exec`, `--json`, `--full-auto`, `--sandbox`, `-C`

If any required flags are missing (e.g., after a breaking CLI update), the extension will show a warning with details about which features are unavailable.
