import React, { useState } from 'react';
import type { ClarificationQuestion } from '../../domain/types.js';

interface ClarificationDialogProps {
  questions: ClarificationQuestion[];
  onSubmit: (answers: { questionId: string; answer: string }[]) => void;
}

export function ClarificationDialog({ questions, onSubmit }: ClarificationDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(questions.map((q) => [q.id, ''])),
  );

  const allAnswered = questions.every((q) => answers[q.id]?.trim());

  const handleSubmit = () => {
    const result = questions.map((q) => ({
      questionId: q.id,
      answer: answers[q.id] ?? '',
    }));
    onSubmit(result);
  };

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
        Agent Questions — Please Answer Before Continuing
      </h3>

      {questions.map((q) => (
        <div key={q.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <span
              style={{
                fontSize: '0.75em',
                padding: '1px 6px',
                borderRadius: 3,
                background: q.source === 'claude' ? 'var(--button-bg)' : 'var(--success-fg)',
                color: 'var(--button-fg)',
              }}
            >
              {q.source === 'claude' ? 'Claude' : 'Codex'}
            </span>
            <span
              style={{
                fontSize: '0.7em',
                padding: '1px 5px',
                borderRadius: 3,
                background: 'var(--border)',
                opacity: 0.7,
              }}
            >
              {q.detectedVia === 'tool_use' ? 'structured' : 'heuristic'}
            </span>
          </div>
          <p style={{ fontSize: '0.9em', marginBottom: 4 }}>{q.questionText}</p>
          <textarea
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
            placeholder="Type your answer..."
            style={{
              width: '100%',
              minHeight: 60,
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
      ))}

      <button className="primary" onClick={handleSubmit} disabled={!allAnswered}>
        Submit Answers
      </button>
    </div>
  );
}
