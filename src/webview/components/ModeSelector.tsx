import React from 'react';
import type { ChatMode } from '../../domain/types.js';
import { CHAT_MODES } from '../../domain/types.js';

interface ModeSelectorProps {
  currentMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
}

export function ModeSelector({ currentMode, onModeChange, disabled }: ModeSelectorProps) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
      {CHAT_MODES.map((mode, idx) => {
        const isActive = currentMode === mode.key;
        const isEdit = mode.key === 'edit';
        const isPlan = mode.key === 'plan';

        // Edit and Plan modes use distinct colors when active (both have edit access)
        const activeBg = isEdit ? 'var(--mode-edit-bg)' : isPlan ? 'var(--mode-plan-bg)' : 'var(--button-bg)';
        const activeFg = isEdit ? 'var(--mode-edit-fg)' : isPlan ? 'var(--mode-plan-fg)' : 'var(--button-fg)';

        return (
          <button
            key={mode.key}
            onClick={() => onModeChange(mode.key)}
            disabled={disabled}
            title={mode.description}
            style={{
              padding: '3px 10px',
              fontSize: '0.75em',
              background: isActive ? activeBg : 'transparent',
              color: isActive ? activeFg : 'var(--foreground)',
              opacity: isActive ? 1 : 0.6,
              borderRight: idx < CHAT_MODES.length - 1 ? '1px solid var(--border)' : 'none',
              borderRadius: 0,
            }}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
