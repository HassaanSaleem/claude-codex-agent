import React, { useEffect } from 'react';
import type { PipelineRunSummary } from '../../domain/types.js';
import { StatusBadge } from './StatusBadge.js';

interface RunHistoryProps {
  runs: PipelineRunSummary[];
  onViewRun: (runId: string) => void;
  onRefresh: () => void;
}

export function RunHistory({ runs, onViewRun, onRefresh }: RunHistoryProps) {
  useEffect(() => {
    onRefresh();
  }, []);

  if (runs.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <p style={{ opacity: 0.6, marginBottom: 8 }}>No pipeline runs found.</p>
        <button className="secondary" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: '1em' }}>Run History</h3>
        <button className="secondary" onClick={onRefresh} style={{ padding: '4px 10px', fontSize: '0.85em' }}>
          Refresh
        </button>
      </div>
      {runs.map((run) => (
        <div
          key={run.runId}
          onClick={() => onViewRun(run.runId)}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '8px 12px',
            marginBottom: 4,
            cursor: 'pointer',
            background: 'var(--input-bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusBadge status={run.status} />
              <span style={{ fontWeight: 600, fontSize: '0.9em' }}>
                {run.taskDescription.slice(0, 60)}
                {run.taskDescription.length > 60 ? '...' : ''}
              </span>
            </div>
            <span style={{ opacity: 0.5, fontSize: '0.8em' }}>
              {run.runId}
            </span>
          </div>
          <div style={{ opacity: 0.6, fontSize: '0.8em', marginTop: 4 }}>
            {run.startedAt} | Iterations: {run.iterationCount}
          </div>
        </div>
      ))}
    </div>
  );
}
