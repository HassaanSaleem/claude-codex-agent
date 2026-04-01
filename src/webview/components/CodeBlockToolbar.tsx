import React, { useState } from 'react';
import { postMessage } from '../hooks/useVsCodeApi.js';

interface CodeBlockToolbarProps {
  code: string;
  language: string;
  filePath?: string;
  isStreaming?: boolean;
}

export function CodeBlockToolbar({ code, language, filePath, isStreaming }: CodeBlockToolbarProps) {
  const [copied, setCopied] = useState(false);

  if (isStreaming) return null;

  const handleCopy = () => {
    postMessage({ type: 'copyToClipboard', text: code });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    postMessage({ type: 'insertAtCursor', text: code });
  };

  const handleOpenFile = () => {
    if (filePath) {
      postMessage({ type: 'openFile', path: filePath });
    }
  };

  return (
    <div
      className="code-block-toolbar"
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
        aria-label={copied ? 'Copied!' : 'Copy code'}
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
        onClick={handleInsert}
        aria-label="Insert at cursor"
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
        Insert
      </button>
      {filePath && (
        <button
          onClick={handleOpenFile}
          aria-label="Open file"
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
          Open File
        </button>
      )}
    </div>
  );
}
