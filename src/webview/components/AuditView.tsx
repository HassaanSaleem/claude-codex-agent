import React from 'react';

interface AuditViewProps {
  auditOutput: string;
}

function severityColor(text: string): string {
  const upper = text.toUpperCase();
  if (upper.includes('CRITICAL') || upper.includes('HIGH')) return 'var(--error-fg)';
  if (upper.includes('MAJOR') || upper.includes('MEDIUM')) return 'var(--warning-fg)';
  return 'var(--foreground)';
}

export function AuditView({ auditOutput }: AuditViewProps) {
  if (!auditOutput) {
    return <div style={{ opacity: 0.6, padding: 12 }}>No audit results yet.</div>;
  }

  const isPassed = auditOutput.toUpperCase().includes('PASS') && !auditOutput.toUpperCase().includes('FIX_REQUIRED');

  return (
    <div style={{ padding: '8px 0' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 10,
          fontSize: '0.85em',
          fontWeight: 600,
          marginBottom: 12,
          background: isPassed ? 'var(--success-fg)' : 'var(--error-fg)',
          color: 'var(--background)',
        }}
      >
        {isPassed ? 'Audit Passed' : 'Fix Required'}
      </div>

      <pre
        style={{
          background: 'var(--input-bg)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: 8,
          maxHeight: 400,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 'var(--vscode-editor-font-size, 12px)',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          lineHeight: 1.5,
        }}
      >
        {auditOutput.split('\n').map((line, i) => (
          <div key={i} style={{ color: severityColor(line) }}>
            {line || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}
