import React, { useRef, useEffect } from 'react';
import type { FileAutocompleteEntry } from '../../domain/types.js';

interface FileAutocompleteProps {
  files: FileAutocompleteEntry[];
  visible: boolean;
  selectedIndex: number;
  onSelect: (file: FileAutocompleteEntry) => void;
  onClose: () => void;
}

export function FileAutocomplete({ files, visible, selectedIndex, onSelect, onClose }: FileAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (!visible || !listRef.current) return;
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, visible]);

  if (!visible || files.length === 0) return null;

  const displayed = files.slice(0, 50);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        maxHeight: 200,
        overflowY: 'auto',
        background: 'var(--input-bg)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        zIndex: 10,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.15)',
      }}
      ref={listRef}
    >
      {displayed.map((file, i) => (
        <div
          key={file.relativePath}
          onClick={() => onSelect(file)}
          style={{
            padding: '4px 8px',
            cursor: 'pointer',
            background: i === selectedIndex ? 'var(--button-bg)' : 'transparent',
            color: i === selectedIndex ? 'var(--button-fg)' : 'var(--foreground)',
            display: 'flex',
            gap: 6,
            alignItems: 'baseline',
            fontSize: '0.85em',
          }}
        >
          <span style={{ fontWeight: 600 }}>{file.fileName}</span>
          <span style={{ opacity: 0.5, fontSize: '0.9em' }}>{file.dirPath === '.' ? '' : file.dirPath}</span>
        </div>
      ))}
    </div>
  );
}
