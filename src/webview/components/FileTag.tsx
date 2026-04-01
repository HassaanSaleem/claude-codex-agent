import React from 'react';
import type { FileReference } from '../../domain/types.js';

interface FileTagProps {
  fileRef: FileReference;
  onClick: (path: string) => void;
}

export function FileTag({ fileRef, onClick }: FileTagProps) {
  const fileName = fileRef.path.split('/').pop() ?? fileRef.path;
  const dirPath = fileRef.path.includes('/') ? fileRef.path.slice(0, fileRef.path.lastIndexOf('/')) : '';

  const isMissing = fileRef.status === 'missing';
  const isBinary = fileRef.status === 'binary';
  const isTruncated = fileRef.status === 'truncated';

  return (
    <span
      onClick={() => onClick(fileRef.path)}
      title={fileRef.path}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        border: '1px solid var(--border)',
        borderRadius: 12,
        fontSize: '0.8em',
        cursor: 'pointer',
        opacity: isMissing || isBinary ? 0.6 : 1,
        textDecoration: isMissing ? 'line-through' : 'none',
        background: 'var(--input-bg)',
        marginRight: 4,
        marginBottom: 4,
      }}
    >
      {fileRef.isSensitive && (
        <span title="Sensitive file" style={{ color: 'var(--warning-fg, #e5a100)' }}>&#9888;</span>
      )}
      {isTruncated && (
        <span title="File truncated (>100KB)" style={{ opacity: 0.7 }}>&#8230;</span>
      )}
      <span style={{ fontWeight: 500 }}>{fileName}</span>
      {dirPath && <span style={{ opacity: 0.5 }}>{dirPath}</span>}
      {isMissing && <span style={{ fontSize: '0.85em', opacity: 0.7 }}>missing</span>}
      {isBinary && <span style={{ fontSize: '0.85em', opacity: 0.7 }}>binary</span>}
    </span>
  );
}
