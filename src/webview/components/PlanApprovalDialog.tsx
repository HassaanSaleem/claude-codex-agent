import React, { useState } from 'react';

interface PlanApprovalDialogProps {
  planText: string;
  reviewFeedback: string;
  onApprove: () => void;
  onEditAndReplan: (additionalContext: string) => void;
}

export function PlanApprovalDialog({ planText, reviewFeedback, onApprove, onEditAndReplan }: PlanApprovalDialogProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [additionalContext, setAdditionalContext] = useState('');

  return (
    <div
      style={{
        border: '1px solid var(--button-bg)',
        borderRadius: 3,
        padding: 12,
        margin: '12px 0',
        background: 'var(--input-bg)',
      }}
    >
      <h3 style={{ color: 'var(--button-bg)', marginBottom: 8, fontSize: '1em' }}>
        Plan Approval Required
      </h3>

      <div
        style={{
          maxHeight: 300,
          overflow: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 3,
          padding: 8,
          marginBottom: 8,
          fontSize: '0.85em',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
        }}
      >
        {planText}
      </div>

      {reviewFeedback && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.9em', opacity: 0.8 }}>
            Review Feedback
          </summary>
          <div
            style={{
              maxHeight: 200,
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: 8,
              marginTop: 4,
              fontSize: '0.85em',
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--vscode-editor-font-family, monospace)',
            }}
          >
            {reviewFeedback}
          </div>
        </details>
      )}

      {showEditor && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: '0.9em', marginBottom: 4 }}>
            Additional context or instructions:
          </label>
          <textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="Describe what should change in the plan..."
            style={{
              width: '100%',
              minHeight: 80,
              padding: 8,
              borderRadius: 3,
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'var(--foreground)',
              fontFamily: 'var(--vscode-editor-font-family, monospace)',
              fontSize: '0.85em',
              resize: 'vertical',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={onApprove}>
          Approve Plan
        </button>
        {!showEditor ? (
          <button className="secondary" onClick={() => setShowEditor(true)}>
            Edit &amp; Re-plan
          </button>
        ) : (
          <button
            className="secondary"
            onClick={() => onEditAndReplan(additionalContext)}
            disabled={!additionalContext.trim()}
          >
            Send Back to Re-plan
          </button>
        )}
      </div>
    </div>
  );
}
