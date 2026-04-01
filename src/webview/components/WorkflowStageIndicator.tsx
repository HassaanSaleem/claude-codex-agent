import React from 'react';
import type { StageName, StageStatus } from '../../domain/types.js';

export interface WorkflowStage {
  name: StageName;
  label: string;
  status: StageStatus | 'pending';
}

const ALL_STAGES: { name: StageName; label: string }[] = [
  { name: 'plan', label: 'Plan' },
  { name: 'review_plan', label: 'Review' },
  { name: 'fix_plan', label: 'Fix' },
  { name: 'human_approval', label: 'Approve' },
  { name: 'implement', label: 'Implement' },
  { name: 'audit', label: 'Audit' },
  { name: 'document', label: 'Document' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--foreground)',
  running: '#4da6ff',
  completed: '#00c850',
  failed: '#ff3c3c',
  skipped: 'var(--foreground)',
};

interface WorkflowStageIndicatorProps {
  stages: WorkflowStage[];
}

export function WorkflowStageIndicator({ stages }: WorkflowStageIndicatorProps) {
  const stageMap = new Map(stages.map((s) => [s.name, s.status]));

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '6px 12px',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      overflowX: 'auto',
    }}>
      {ALL_STAGES.map((stage, idx) => {
        const status = stageMap.get(stage.name) ?? 'pending';
        const color = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
        const isRunning = status === 'running';
        return (
          <React.Fragment key={stage.name}>
            {idx > 0 && (
              <span style={{ fontSize: '0.6em', opacity: 0.3, margin: '0 2px' }}>&rsaquo;</span>
            )}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              opacity: status === 'pending' ? 0.4 : 1,
            }}>
              <span style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: color,
                animation: isRunning ? 'blink 1s infinite' : 'none',
              }} />
              <span style={{
                fontSize: '0.7em',
                fontWeight: isRunning ? 600 : 400,
                color,
              }}>
                {stage.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function buildInitialStages(): WorkflowStage[] {
  return ALL_STAGES.map((s) => ({ ...s, status: 'pending' as const }));
}
