import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { ChatMode, FileAutocompleteEntry } from '../../domain/types.js';
import { FileAutocomplete } from './FileAutocomplete.js';
import { postMessage } from '../hooks/useVsCodeApi.js';

interface ChatInputProps {
  isStreaming: boolean;
  isWorkflowMode?: boolean;
  currentMode?: ChatMode;
  autocompleteFiles: FileAutocompleteEntry[];
  activeEditorFile?: string | null;
  pinnedFiles?: string[];
  onSend: (text: string, fileReferences: { path: string }[], skipAutoAttach?: boolean) => void;
  onCancel: () => void;
  onRunPipeline: (taskDescription: string, fileReferences: { path: string }[]) => void;
  onPinFile?: (filePath: string) => void;
  onUnpinFile?: (filePath: string) => void;
}

/** Find the start of the @token the cursor is inside, or -1. */
function findAtTokenStart(text: string, cursorPos: number): number {
  // Walk backwards from cursor to find an unmatched '@'
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (text[i] === '@') {
      // Valid if at start of string or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) return i;
      return -1;
    }
    // Stop if we hit whitespace — means we're past the token
    if (/\s/.test(text[i])) return -1;
  }
  return -1;
}

/** Extract all @path tokens from text and return { cleanedText, paths }. */
function parseFileTokens(text: string): { cleanedText: string; paths: string[] } {
  const paths: string[] = [];
  // Match @<non-whitespace> tokens
  const cleaned = text.replace(/@(\S+)/g, (_match, filePath: string) => {
    paths.push(filePath);
    return '';
  });
  return { cleanedText: cleaned.replace(/ {2,}/g, ' ').trim(), paths: [...new Set(paths)] };
}

const MODE_PLACEHOLDERS: Record<ChatMode, string> = {
  ask: 'Ask about your codebase... (Cmd+Enter to send, @ to reference files)',
  plan: 'Describe what to build... (Cmd+Enter to send, @ to reference files)',
  edit: 'Describe the changes... (Cmd+Enter to send, @ to reference files)',
};

export function ChatInput({ isStreaming, isWorkflowMode, currentMode, autocompleteFiles, activeEditorFile, pinnedFiles, onSend, onCancel, onRunPipeline, onPinFile, onUnpinFile }: ChatInputProps) {
  const [text, setText] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedFile, setDismissedFile] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset dismissed file when pinned files change (indicates session switch or new chat)
  useEffect(() => {
    setDismissedFile(null);
  }, [pinnedFiles]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    const { cleanedText, paths } = parseFileTokens(trimmed);
    const fileRefs = paths.map((p) => ({ path: p }));
    const skip = activeEditorFile === dismissedFile;
    onSend(cleanedText, fileRefs, skip);
    setText('');
    setShowAutocomplete(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isStreaming, onSend, activeEditorFile, dismissedFile]);

  const handleSelectFile = useCallback((file: FileAutocompleteEntry) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart;
    const atStart = findAtTokenStart(text, cursorPos);
    if (atStart < 0) return;

    const before = text.slice(0, atStart);
    const after = text.slice(cursorPos);
    const newText = `${before}@${file.relativePath} ${after}`;
    setText(newText);
    setShowAutocomplete(false);
    setSelectedIndex(0);

    // Move cursor to after the inserted path
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const newPos = atStart + file.relativePath.length + 2; // @path + space
        textareaRef.current.selectionStart = newPos;
        textareaRef.current.selectionEnd = newPos;
        textareaRef.current.focus();
      }
    });
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAutocomplete && autocompleteFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, Math.min(autocompleteFiles.length, 50) - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectFile(autocompleteFiles[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;

    // Check for @ trigger
    const cursorPos = el.selectionStart;
    const atStart = findAtTokenStart(newText, cursorPos);

    if (atStart >= 0) {
      const query = newText.slice(atStart + 1, cursorPos);
      setShowAutocomplete(true);
      setSelectedIndex(0);
      postMessage({ type: 'requestFileList', query });
    } else {
      setShowAutocomplete(false);
    }
  };

  const handleRunPipeline = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { cleanedText, paths } = parseFileTokens(trimmed);
    const fileRefs = paths.map((p) => ({ path: p }));
    onRunPipeline(cleanedText, fileRefs);
    setText('');
    setShowAutocomplete(false);
  };

  const placeholder = isWorkflowMode
    ? 'Describe the task... (Cmd+Enter to run, @ to reference files)'
    : MODE_PLACEHOLDERS[currentMode ?? 'ask'];

  const sendLabel = isWorkflowMode ? 'Run' : 'Send';

  // Filename only (strip directories) for the active editor tag
  const activeFileName = activeEditorFile ? activeEditorFile.split('/').pop() : null;
  const showActiveTag = activeFileName && activeEditorFile !== dismissedFile;

  return (
    <div style={{ padding: '8px', borderTop: '1px solid var(--border)', position: 'relative' }}>
      <FileAutocomplete
        files={autocompleteFiles}
        visible={showAutocomplete}
        selectedIndex={selectedIndex}
        onSelect={handleSelectFile}
        onClose={() => setShowAutocomplete(false)}
      />
      {/* Pinned files (010-pinned-files) */}
      {pinnedFiles && pinnedFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {pinnedFiles.map((fp) => (
            <span
              key={fp}
              title={fp}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: 'var(--button-bg)',
                color: 'var(--button-fg)',
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: '0.72em',
              }}
            >
              <span style={{ opacity: 0.6 }}>&#128204;</span>
              {fp.split('/').pop()}
              <button
                onClick={() => onUnpinFile?.(fp)}
                title="Unpin file"
                style={{
                  background: 'transparent',
                  color: 'inherit',
                  border: 'none',
                  padding: '0 1px',
                  cursor: 'pointer',
                  fontSize: '1em',
                  lineHeight: 1,
                  opacity: 0.7,
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      {showActiveTag && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: '0.75em', opacity: 0.7 }}>
          <span
            style={{
              background: 'var(--button-secondary-bg)',
              color: 'var(--button-secondary-fg)',
              padding: '1px 6px',
              borderRadius: 3,
            }}
            title={activeEditorFile ?? ''}
          >
            {activeFileName}
          </span>
          <span>auto-attached</span>
          {onPinFile && activeEditorFile && !(pinnedFiles ?? []).includes(activeEditorFile) && (
            <button
              onClick={() => onPinFile(activeEditorFile)}
              title="Pin this file to every message"
              style={{
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                padding: '0 2px',
                cursor: 'pointer',
                fontSize: '0.9em',
                lineHeight: 1,
                opacity: 0.6,
              }}
            >
              &#128204;
            </button>
          )}
          <button
            onClick={() => setDismissedFile(activeEditorFile ?? null)}
            title="Don't attach this file"
            style={{
              background: 'transparent',
              color: 'inherit',
              border: 'none',
              padding: '0 2px',
              cursor: 'pointer',
              fontSize: '1.1em',
              lineHeight: 1,
              opacity: 0.6,
            }}
          >
            x
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        style={{
          width: '100%',
          resize: 'none',
          marginBottom: 8,
          minHeight: 36,
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {!isWorkflowMode && (
          <button
            className="secondary"
            onClick={handleRunPipeline}
            disabled={isStreaming || !text.trim()}
            title="Run as pipeline task"
            style={{ fontSize: '0.8em' }}
          >
            Run Pipeline
          </button>
        )}
        {isStreaming ? (
          <button className="secondary" onClick={onCancel} style={{ fontSize: '0.8em' }}>
            Stop
          </button>
        ) : (
          <button
            className="primary"
            onClick={handleSend}
            disabled={!text.trim()}
            style={{ fontSize: '0.8em' }}
          >
            {sendLabel}
          </button>
        )}
      </div>
    </div>
  );
}
