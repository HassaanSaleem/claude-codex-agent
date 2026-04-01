import React, { useState } from 'react';
import { postMessage } from '../hooks/useVsCodeApi.js';

interface TaskInputProps {
  isRunning: boolean;
}

export function TaskInput({ isRunning }: TaskInputProps) {
  const [task, setTask] = useState('');

  const handleSubmit = () => {
    const trimmed = task.trim();
    if (!trimmed || isRunning) return;
    postMessage({ type: 'startPipeline', taskDescription: trimmed });
  };

  const handleCancel = () => {
    postMessage({ type: 'cancelPipeline' });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <label htmlFor="task-input" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
        Task Description
      </label>
      <textarea
        id="task-input"
        value={task}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTask(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe the task (e.g., add a health check endpoint)..."
        rows={3}
        disabled={isRunning}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="primary"
          onClick={handleSubmit}
          disabled={isRunning || !task.trim()}
        >
          Run Pipeline
        </button>
        {isRunning && (
          <button className="secondary" onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
