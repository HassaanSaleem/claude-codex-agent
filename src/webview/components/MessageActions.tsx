import React, { useState } from 'react';
import { postMessage } from '../hooks/useVsCodeApi.js';

interface MessageActionsProps {
  messageId: string;
  content: string;
  isStreaming?: boolean;
  onRetry: (messageId: string) => void;
}

export function MessageActions({ messageId, content, isStreaming, onRetry }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  if (isStreaming) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    postMessage({ type: 'copyToClipboard', text: content });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRetry(messageId);
  };

  return (
    <div
      className="message-actions-toolbar"
      style={{
        position: 'absolute',
        top: 'var(--space-1)',
        right: 'var(--space-1)',
        display: 'flex',
        gap: 2,
        opacity: 0,
        transition: 'opacity 0.15s ease-in',
        background: 'var(--code-toolbar-bg)',
        borderRadius: 3,
        padding: 2,
        zIndex: 1,
      }}
    >
      <button
        onClick={handleCopy}
        aria-label={copied ? 'Copied!' : 'Copy response'}
        tabIndex={0}
        style={{
          background: 'transparent',
          color: 'var(--foreground)',
          padding: '2px 6px',
          fontSize: 'var(--text-xs)',
          borderRadius: 2,
          opacity: 0.7,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <button
        onClick={handleRetry}
        aria-label="Retry response"
        tabIndex={0}
        style={{
          background: 'transparent',
          color: 'var(--foreground)',
          padding: '2px 6px',
          fontSize: 'var(--text-xs)',
          borderRadius: 2,
          opacity: 0.7,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Retry
      </button>
    </div>
  );
}
