import React from 'react';
import type { StageStatus, StageName } from '../../domain/types.js';
import { STAGE_ORDER, STAGE_LABELS } from '../../domain/constants.js';

interface ProgressBarProps {
  stageStatuses: Record<string, StageStatus>;
  currentStage: string | null;
}

function stageColor(status: StageStatus | undefined, isCurrent: boolean, stageName: StageName): string {
  if (status === 'completed') return 'var(--success-fg)';
  if (status === 'failed') return 'var(--error-fg)';
  if ((isCurrent || status === 'running') && stageName === 'human_approval') return '#d97706';
  if (isCurrent || status === 'running') return 'var(--button-bg)';
  return 'var(--badge-bg)';
}

export function ProgressBar({ stageStatuses, currentStage }: ProgressBarProps) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '8px 0' }}>
      {STAGE_ORDER.map((stage, i) => {
        const status = stageStatuses[stage];
        const isCurrent = stage === currentStage;
        const bg = stageColor(status, isCurrent, stage);

        return (
          <React.Fragment key={stage}>
            {i > 0 && (
              <div
                style={{
                  width: 16,
                  height: 2,
                  background: status === 'completed' ? 'var(--success-fg)' : 'var(--badge-bg)',
                }}
              />
            )}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: bg,
                  transition: 'background 0.2s',
                }}
              />
              <span style={{ fontSize: '0.75em', opacity: 0.8 }}>
                {STAGE_LABELS[stage]}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
