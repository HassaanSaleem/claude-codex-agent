import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { PipelineApp } from './PipelineApp.js';
import { ChatApp } from './ChatApp.js';
import './styles/vscode-theme.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--vscode-errorForeground, #f44)' }}>
          <h3>Something went wrong</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em', opacity: 0.8 }}>
            {this.state.error.message}
          </pre>
          <button
            style={{ marginTop: 12, cursor: 'pointer' }}
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById('root');
if (container) {
  const mode = container.getAttribute('data-mode') ?? 'pipeline';
  const root = createRoot(container);
  root.render(
    <ErrorBoundary>
      {mode === 'chat' ? <ChatApp /> : <PipelineApp />}
    </ErrorBoundary>,
  );
}
