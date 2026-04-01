import React from 'react';

interface DiffViewProps {
  diff: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
}

function parseDiffLines(diff: string): DiffLine[] {
  return diff.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      return { type: 'header' as const, content: line };
    }
    if (line.startsWith('@@')) {
      return { type: 'header' as const, content: line };
    }
    if (line.startsWith('+')) {
      return { type: 'add' as const, content: line };
    }
    if (line.startsWith('-')) {
      return { type: 'remove' as const, content: line };
    }
    return { type: 'context' as const, content: line };
  });
}

function lineColor(type: DiffLine['type']): string {
  switch (type) {
    case 'add': return 'rgba(35, 134, 54, 0.2)';
    case 'remove': return 'rgba(218, 54, 51, 0.2)';
    case 'header': return 'rgba(130, 130, 130, 0.15)';
    default: return 'transparent';
  }
}

function textColor(type: DiffLine['type']): string {
  switch (type) {
    case 'add': return 'var(--success-fg)';
    case 'remove': return 'var(--error-fg)';
    case 'header': return 'var(--foreground)';
    default: return 'var(--foreground)';
  }
}

export function DiffView({ diff }: DiffViewProps) {
  if (!diff) {
    return <div style={{ opacity: 0.6, padding: 12 }}>No diff available yet.</div>;
  }

  const lines = parseDiffLines(diff);

  // Count stats
  const added = lines.filter(l => l.type === 'add').length;
  const removed = lines.filter(l => l.type === 'remove').length;

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ marginBottom: 8, fontSize: '0.85em', opacity: 0.7 }}>
        <span style={{ color: 'var(--success-fg)' }}>+{added}</span>
        {' / '}
        <span style={{ color: 'var(--error-fg)' }}>-{removed}</span>
        {' lines changed'}
      </div>
      <pre
        style={{
          background: 'var(--input-bg)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: 0,
          margin: 0,
          maxHeight: 500,
          overflow: 'auto',
          fontSize: 'var(--vscode-editor-font-size, 12px)',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              background: lineColor(line.type),
              color: textColor(line.type),
              padding: '1px 8px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontWeight: line.type === 'header' ? 600 : 400,
            }}
          >
            {line.content || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}
