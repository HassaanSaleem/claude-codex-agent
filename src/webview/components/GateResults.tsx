import React, { useState } from 'react';
import type { GateResult } from '../../domain/types.js';
import { StatusBadge } from './StatusBadge.js';

interface GateResultsProps {
  results: GateResult[];
}

function GateItem({ result }: { result: GateResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 3,
        marginBottom: 4,
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          cursor: 'pointer',
          background: 'var(--input-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={result.passed ? 'passed' : 'failed'} />
          <span style={{ fontWeight: 600 }}>{result.toolName}</span>
          <span style={{ opacity: 0.6, fontSize: '0.85em' }}>
            {result.durationSeconds.toFixed(1)}s
          </span>
        </div>
        <span style={{ fontSize: '0.8em', opacity: 0.6 }}>
          {expanded ? '\u25B2' : '\u25BC'}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: 8 }}>
          <div style={{ fontSize: '0.85em', opacity: 0.7, marginBottom: 4 }}>
            <code>{result.command}</code> (exit: {result.exitCode})
          </div>
          {result.stdout && (
            <pre
              style={{
                background: 'var(--background)',
                padding: 6,
                borderRadius: 2,
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '0.85em',
                marginBottom: 4,
              }}
            >
              {result.stdout}
            </pre>
          )}
          {result.stderr && (
            <pre
              style={{
                background: 'var(--background)',
                padding: 6,
                borderRadius: 2,
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '0.85em',
                color: 'var(--error-fg)',
              }}
            >
              {result.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function GateResults({ results }: GateResultsProps) {
  if (results.length === 0) return null;

  return (
    <div style={{ margin: '12px 0' }}>
      <h3 style={{ marginBottom: 8, fontSize: '1em' }}>Gate Results</h3>
      {results.map((r, i) => (
        <GateItem key={`${r.toolName}-${i}`} result={r} />
      ))}
    </div>
  );
}
