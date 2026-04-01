import React from 'react';

interface PlanViewProps {
  planText: string;
}

function renderMarkdownSimple(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('### ')) {
      return <h4 key={i} style={{ margin: '12px 0 4px', fontSize: '0.95em' }}>{line.slice(4)}</h4>;
    }
    if (line.startsWith('## ')) {
      return <h3 key={i} style={{ margin: '16px 0 8px', fontSize: '1.05em' }}>{line.slice(3)}</h3>;
    }
    if (line.startsWith('# ')) {
      return <h2 key={i} style={{ margin: '16px 0 8px', fontSize: '1.15em' }}>{line.slice(2)}</h2>;
    }
    if (line.startsWith('- ')) {
      return (
        <div key={i} style={{ paddingLeft: 16, margin: '2px 0' }}>
          &bull; {line.slice(2)}
        </div>
      );
    }
    if (line.match(/^\d+\.\s/)) {
      return (
        <div key={i} style={{ paddingLeft: 16, margin: '2px 0' }}>
          {line}
        </div>
      );
    }
    if (line.trim() === '') {
      return <br key={i} />;
    }
    return <p key={i} style={{ margin: '2px 0' }}>{line}</p>;
  });
}

export function PlanView({ planText }: PlanViewProps) {
  if (!planText) {
    return <div style={{ opacity: 0.6, padding: 12 }}>No plan available yet.</div>;
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {renderMarkdownSimple(planText)}
    </div>
  );
}
