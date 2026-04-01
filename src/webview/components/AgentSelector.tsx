import React from 'react';
import type { AgentType } from '../../domain/types.js';

interface AgentSelectorProps {
  currentAgent: AgentType;
  onSwitch: (agent: AgentType) => void;
  disabled?: boolean;
}

const AGENTS: { key: AgentType; label: string }[] = [
  { key: 'claude', label: 'Claude' },
  { key: 'codex', label: 'Codex' },
  { key: 'workflow', label: 'Workflow' },
];

export function AgentSelector({ currentAgent, onSwitch, disabled }: AgentSelectorProps) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
      {AGENTS.map((agent, idx) => (
        <button
          key={agent.key}
          onClick={() => onSwitch(agent.key)}
          disabled={disabled}
          style={{
            padding: '4px 12px',
            fontSize: '0.8em',
            background: currentAgent === agent.key ? 'var(--button-bg)' : 'transparent',
            color: currentAgent === agent.key ? 'var(--button-fg)' : 'var(--foreground)',
            opacity: currentAgent === agent.key ? 1 : 0.6,
            borderRight: idx < AGENTS.length - 1 ? '1px solid var(--border)' : 'none',
            borderRadius: 0,
          }}
        >
          {agent.label}
        </button>
      ))}
    </div>
  );
}
