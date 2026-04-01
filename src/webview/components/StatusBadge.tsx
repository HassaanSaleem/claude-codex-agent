import React from 'react';
import type { PipelineStatus, StageStatus } from '../../domain/types.js';

type BadgeStatus = PipelineStatus | StageStatus;

interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
}

function badgeColor(status: BadgeStatus): string {
  switch (status) {
    case 'passed':
    case 'completed':
      return 'var(--success-fg)';
    case 'failed':
      return 'var(--error-fg)';
    case 'running':
      return 'var(--button-bg)';
    case 'cancelled':
      return 'var(--warning-fg)';
    case 'skipped':
      return 'var(--badge-bg)';
    default:
      return 'var(--badge-bg)';
  }
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const color = badgeColor(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: '0.8em',
        fontWeight: 600,
        background: color,
        color: 'var(--background)',
      }}
    >
      {label ?? status}
    </span>
  );
}
