import React from 'react';
import type { AgentType } from '../../domain/types.js';
import { CLAUDE_MODELS, CODEX_MODELS } from '../../domain/types.js';

interface ModelSelectorProps {
  currentAgent: AgentType;
  currentModel: string | null;  // null = default from settings
  onModelChange: (modelId: string | null) => void;
  disabled?: boolean;
}

export function ModelSelector({ currentAgent, currentModel, onModelChange, disabled }: ModelSelectorProps) {
  const models = currentAgent === 'claude' ? CLAUDE_MODELS : currentAgent === 'codex' ? CODEX_MODELS : [];
  if (models.length === 0) return null;

  return (
    <select
      value={currentModel ?? ''}
      onChange={(e) => onModelChange(e.target.value || null)}
      disabled={disabled}
      title="Select model"
      style={{
        background: 'var(--input-bg)',
        color: 'var(--foreground)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        padding: '3px 6px',
        fontSize: '0.75em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <option value="">Default</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
    </select>
  );
}
