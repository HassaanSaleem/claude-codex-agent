import React, { useEffect, useRef } from 'react';

interface StreamingOutputProps {
  output: string;
  currentStage: string | null;
}

export function StreamingOutput({ output, currentStage }: StreamingOutputProps) {
  const containerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  if (!output && !currentStage) return null;

  return (
    <div style={{ margin: '12px 0' }}>
      {currentStage && (
        <div style={{ marginBottom: 4, fontSize: '0.9em', opacity: 0.8 }}>
          Stage: <strong>{currentStage}</strong>
        </div>
      )}
      <pre
        ref={containerRef}
        style={{
          background: 'var(--input-bg)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: 8,
          maxHeight: 300,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 'var(--vscode-editor-font-size, 12px)',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
        }}
      >
        {output || 'Waiting for output...'}
      </pre>
    </div>
  );
}
