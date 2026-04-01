import React from 'react';

interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottom({ visible, onClick }: ScrollToBottomProps) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      aria-label="Scroll to bottom"
      tabIndex={0}
      style={{
        position: 'absolute',
        bottom: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--button-secondary-bg)',
        color: 'var(--button-secondary-fg)',
        padding: '4px 12px',
        borderRadius: 12,
        fontSize: 'var(--text-xs)',
        opacity: visible ? 0.9 : 0,
        transition: 'opacity 0.2s ease-in',
        cursor: 'pointer',
        zIndex: 2,
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      ↓ Scroll to bottom
    </button>
  );
}
