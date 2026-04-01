import React from 'react';

interface ThinkingSectionProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingSection({ content, isStreaming }: ThinkingSectionProps) {
  if (!content) return null;

  return (
    <details
      style={{
        marginBottom: 'var(--space-2)',
        borderRadius: 4,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          padding: 'var(--space-1) var(--space-2)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
          userSelect: 'none',
          color: 'var(--foreground)',
          opacity: 0.7,
          background: 'var(--panel-bg)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}
      >
        {isStreaming ? (
          <>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--button-bg)',
                animation: 'typingPulse 1.4s ease-in-out infinite',
              }}
            />
            Thinking...
          </>
        ) : (
          'Thought process'
        )}
      </summary>
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--code-font)',
          fontSize: 'var(--code-font-size)',
          lineHeight: 1.5,
          color: 'var(--foreground)',
          opacity: 0.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        {content}
      </div>
    </details>
  );
}
