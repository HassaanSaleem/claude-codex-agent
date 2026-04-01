import React, { useState } from 'react';
import type { ChatMessage, ChatMessageMetadata, ClarificationQuestion, HumanApprovalDecision } from '../../domain/types.js';
import { postMessage } from '../hooks/useVsCodeApi.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { MessageActions } from './MessageActions.js';
import { ThinkingSection } from './ThinkingSection.js';
import { FileTag } from './FileTag.js';

interface ChatBubbleProps {
  message: ChatMessage;
}

const STAGE_LABELS: Record<string, string> = {
  plan: 'Plan',
  review_plan: 'Review',
  fix_plan: 'Fix Plan',
  human_approval: 'Approval',
  implement: 'Implement',
  audit: 'Audit',
  document: 'Document',
};

const STAGE_AGENTS: Record<string, string> = {
  plan: 'Claude',
  review_plan: 'Codex',
  fix_plan: 'Claude',
  human_approval: '',
  implement: 'Claude',
  audit: 'Codex',
  document: 'Claude',
};

function StageHeader({ metadata }: { metadata: Extract<ChatMessageMetadata, { kind: 'stage_header' }> }) {
  const label = STAGE_LABELS[metadata.stageName] ?? metadata.stageName;
  const agent = STAGE_AGENTS[metadata.stageName];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
      fontSize: '0.8em',
      fontWeight: 600,
      opacity: 0.8,
    }}>
      <span style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--button-bg)',
      }} />
      Workflow / {label}
      {agent && (
        <span style={{
          fontSize: '0.85em',
          fontWeight: 500,
          opacity: 0.7,
          padding: '1px 6px',
          borderRadius: 3,
          background: 'var(--hover-bg)',
        }}>
          {agent}
        </span>
      )}
      <span style={{ opacity: 0.5, fontWeight: 400 }}>
        (iteration {metadata.iteration})
      </span>
    </div>
  );
}

function ApprovalRequest({ metadata, messageId }: { metadata: Extract<ChatMessageMetadata, { kind: 'approval_request' }>; messageId: string }) {
  const [additionalContext, setAdditionalContext] = useState('');
  const [responded, setResponded] = useState(metadata.responded ?? false);

  const handleDecision = (decision: HumanApprovalDecision) => {
    setResponded(true);
    postMessage({ type: 'markResponded', messageId });
    postMessage({
      type: 'workflowApproval',
      decision,
      additionalContext: additionalContext.trim() || undefined,
    });
  };

  if (responded) {
    return (
      <div style={{ padding: '8px 0', fontSize: '0.85em', opacity: 0.7 }}>
        Response submitted.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={additionalContext}
        onChange={(e) => setAdditionalContext(e.target.value)}
        placeholder="Additional context (optional)..."
        rows={2}
        style={{ width: '100%', marginBottom: 6, fontSize: '0.85em', resize: 'none' }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="primary"
          onClick={() => handleDecision('approve')}
          style={{ fontSize: '0.8em' }}
        >
          Approve
        </button>
        <button
          className="secondary"
          onClick={() => handleDecision('edit_and_replan')}
          style={{ fontSize: '0.8em' }}
        >
          Edit &amp; Replan
        </button>
      </div>
    </div>
  );
}

function PatchBudgetRequest({ metadata, messageId }: { metadata: Extract<ChatMessageMetadata, { kind: 'patch_budget_request' }>; messageId: string }) {
  const [responded, setResponded] = useState(metadata.responded ?? false);

  const handle = (approved: boolean) => {
    setResponded(true);
    postMessage({ type: 'markResponded', messageId });
    postMessage({ type: 'workflowApprovePatchBudget', approved });
  };

  if (responded) {
    return (
      <div style={{ padding: '8px 0', fontSize: '0.85em', opacity: 0.7 }}>
        Response submitted.
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 8,
      padding: '8px 10px',
      background: 'var(--input-bg)',
      borderRadius: 4,
      borderLeft: '3px solid orange',
    }}>
      <div style={{ fontSize: '0.85em', marginBottom: 6 }}>
        Patch budget exceeded: <strong>{metadata.linesChanged}</strong> lines changed (budget: {metadata.budget})
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="primary" onClick={() => handle(true)} style={{ fontSize: '0.8em' }}>
          Approve
        </button>
        <button className="secondary" onClick={() => handle(false)} style={{ fontSize: '0.8em' }}>
          Reject
        </button>
      </div>
    </div>
  );
}

function GateResultBadge({ metadata }: { metadata: Extract<ChatMessageMetadata, { kind: 'gate_result' }> }) {
  const { result } = metadata;
  const passed = result.passed;
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 4,
      background: passed ? 'var(--hover-bg)' : 'rgba(255, 80, 80, 0.1)',
      color: passed ? 'var(--success-fg)' : 'var(--error-fg)',
      fontSize: '0.82em',
      fontWeight: 600,
      marginTop: 4,
    }}>
      {passed ? '\u2713' : '\u2717'} {result.toolName}
      <span style={{ opacity: 0.6, fontWeight: 400 }}>
        ({result.durationSeconds.toFixed(1)}s)
      </span>
    </div>
  );
}

function WorkflowComplete({ metadata }: { metadata: Extract<ChatMessageMetadata, { kind: 'workflow_complete' }> }) {
  const isPassed = metadata.status === 'passed';
  const stageLabel = metadata.failedStage ? STAGE_LABELS[metadata.failedStage] ?? metadata.failedStage : null;
  return (
    <div style={{
      marginTop: 8,
      padding: '10px 12px',
      borderRadius: 6,
      background: 'var(--panel-bg)',
      border: `1px solid ${isPassed ? 'var(--success-fg)' : 'var(--error-fg)'}`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
      }}>
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 3,
          fontSize: '0.75em',
          fontWeight: 700,
          textTransform: 'uppercase',
          background: 'var(--hover-bg)',
          color: isPassed ? 'var(--success-fg)' : 'var(--error-fg)',
        }}>
          {metadata.status}
        </span>
        <span style={{ fontWeight: 600, fontSize: '0.9em' }}>Workflow Complete</span>
      </div>
      <div style={{ fontSize: '0.85em', opacity: 0.8 }}>{metadata.summary}</div>
      {!isPassed && (
        <button
          onClick={() => postMessage({ type: 'retryWorkflow' })}
          style={{
            marginTop: 8,
            padding: '4px 12px',
            fontSize: '0.8em',
            borderRadius: 4,
            background: 'var(--button-bg)',
            color: 'var(--button-fg)',
            cursor: 'pointer',
          }}
        >
          {stageLabel ? `Retry from ${stageLabel}` : 'Retry Workflow'}
        </button>
      )}
    </div>
  );
}

function ClarificationRequest({ metadata, isWorkflow, messageId }: { metadata: Extract<ChatMessageMetadata, { kind: 'clarification_request' }>; isWorkflow?: boolean; messageId: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(metadata.responded ?? false);

  const allAnswered = metadata.questions.every((q) => {
    return (selectedOptions[q.id] || answers[q.id]?.trim());
  });

  const handleSubmit = () => {
    setSubmitted(true);
    postMessage({ type: 'markResponded', messageId });
    if (isWorkflow) {
      // In workflow mode, send structured answers back via resolver
      const structuredAnswers = metadata.questions.map((q) => ({
        questionId: q.id,
        answer: selectedOptions[q.id] || answers[q.id] || '',
      }));
      postMessage({ type: 'workflowClarificationAnswer', answers: structuredAnswers });
    } else {
      // In chat mode, send as next chat message
      const answerLines = metadata.questions.map((q) => {
        const answer = selectedOptions[q.id] || answers[q.id] || '';
        return `${q.questionText}\nAnswer: ${answer}`;
      });
      postMessage({ type: 'sendChatMessage', text: answerLines.join('\n\n') });
    }
  };

  if (submitted) {
    return (
      <div style={{ padding: '8px 0', fontSize: '0.85em', opacity: 0.7 }}>
        Answers submitted.
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--button-bg)',
      borderRadius: 6,
      padding: 12,
      margin: '8px 0',
      background: 'var(--input-bg)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
        fontSize: '0.85em',
        fontWeight: 600,
        color: 'var(--button-bg)',
      }}>
        <span style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--button-bg)',
        }} />
        Agent Question{metadata.questions.length > 1 ? 's' : ''}
      </div>

      {metadata.questions.map((q) => (
        <div key={q.id} style={{ marginBottom: 12 }}>
          <p style={{ fontSize: '0.9em', marginBottom: 6, fontWeight: 500 }}>{q.questionText}</p>

          {q.options && q.options.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
              {q.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setSelectedOptions((prev) => ({ ...prev, [q.id]: opt.label }))}
                  style={{
                    textAlign: 'left',
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: selectedOptions[q.id] === opt.label
                      ? '2px solid var(--button-bg)'
                      : '1px solid var(--border)',
                    background: selectedOptions[q.id] === opt.label
                      ? 'var(--hover-bg)'
                      : 'var(--background)',
                    color: 'var(--foreground)',
                    fontSize: '0.85em',
                    cursor: 'pointer',
                  }}
                >
                  <strong>{opt.label}</strong>
                  {opt.description && (
                    <span style={{ opacity: 0.7, marginLeft: 6 }}>— {opt.description}</span>
                  )}
                </button>
              ))}
              {/* Custom answer option */}
              <input
                type="text"
                value={answers[q.id] ?? ''}
                onChange={(e) => {
                  setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }));
                  setSelectedOptions((prev) => ({ ...prev, [q.id]: '' }));
                }}
                placeholder="Or type a custom answer..."
                style={{
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  fontSize: '0.85em',
                }}
              />
            </div>
          ) : (
            <textarea
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              placeholder="Type your answer..."
              rows={2}
              style={{
                width: '100%',
                padding: 8,
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: '0.85em',
                resize: 'vertical',
              }}
            />
          )}
        </div>
      ))}

      <button
        className="primary"
        onClick={handleSubmit}
        disabled={!allAnswered}
        style={{ fontSize: '0.8em' }}
      >
        Submit Answer{metadata.questions.length > 1 ? 's' : ''}
      </button>
    </div>
  );
}

function MetadataContent({ metadata, isWorkflow, messageId }: { metadata: ChatMessageMetadata; isWorkflow?: boolean; messageId: string }) {
  switch (metadata.kind) {
    case 'stage_header':
      return <StageHeader metadata={metadata} />;
    case 'approval_request':
      return <ApprovalRequest metadata={metadata} messageId={messageId} />;
    case 'patch_budget_request':
      return <PatchBudgetRequest metadata={metadata} messageId={messageId} />;
    case 'gate_result':
      return <GateResultBadge metadata={metadata} />;
    case 'workflow_complete':
      return <WorkflowComplete metadata={metadata} />;
    case 'clarification_request':
      return <ClarificationRequest metadata={metadata} isWorkflow={isWorkflow} messageId={messageId} />;
    default:
      return null;
  }
}

export const ChatBubble = React.memo(function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      {!isUser && message.agent && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: '0.75em', opacity: 0.6, textTransform: 'capitalize' }}>
            {message.agent}
          </span>
          {message.mode === 'plan' && (
            <span style={{
              fontSize: '0.65em',
              padding: '1px 5px',
              borderRadius: 3,
              background: 'var(--mode-badge-plan-bg)',
              color: 'var(--mode-badge-plan-fg)',
              fontWeight: 600,
            }}>
              plan
            </span>
          )}
          {message.mode === 'edit' && (
            <span style={{
              fontSize: '0.65em',
              padding: '1px 5px',
              borderRadius: 3,
              background: 'var(--mode-badge-edit-bg)',
              color: 'var(--mode-badge-edit-fg)',
              fontWeight: 600,
            }}>
              edit
            </span>
          )}
          {message.model && (
            <span style={{
              fontSize: '0.65em',
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(255,255,255,0.08)',
              color: 'var(--foreground)',
              fontWeight: 600,
              opacity: 0.7,
            }}>
              {message.model}
            </span>
          )}
        </div>
      )}
      {!isUser && message.thinkingContent && (
        <div style={{ width: '100%', maxWidth: '85%' }}>
          <ThinkingSection content={message.thinkingContent} isStreaming={message.isStreaming} />
        </div>
      )}
      {message.metadata && (
        <div style={{ width: '100%', maxWidth: '85%' }}>
          <MetadataContent metadata={message.metadata} isWorkflow={message.agent === 'workflow'} messageId={message.id} />
        </div>
      )}
      <div
        className={!isUser ? 'message-hover-container' : undefined}
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 8,
          background: isUser ? 'var(--button-bg)' : 'var(--input-bg)',
          color: isUser ? 'var(--button-fg)' : 'var(--foreground)',
          wordBreak: 'break-word',
          fontSize: '0.9em',
          lineHeight: 1.5,
          minHeight: message.isStreaming && !message.content ? 28 : undefined,
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {!isUser && !message.isStreaming && message.content && (
          <MessageActions
            messageId={message.id}
            content={message.content}
            isStreaming={message.isStreaming}
            onRetry={(messageId) => postMessage({ type: 'retryMessage', messageId })}
          />
        )}
        {message.isStreaming && !message.content ? (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--foreground)', opacity: 0.4, animation: 'typingPulse 1.4s ease-in-out infinite' }} />
            <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--foreground)', opacity: 0.4, animation: 'typingPulse 1.4s ease-in-out 0.2s infinite' }} />
            <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--foreground)', opacity: 0.4, animation: 'typingPulse 1.4s ease-in-out 0.4s infinite' }} />
          </span>
        ) : (
          <div style={{ width: '100%' }}>
            {isUser ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
            ) : (
              <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} fileReferences={message.fileReferences} />
            )}
            {message.isStreaming && (
              <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}> |</span>
            )}
          </div>
        )}
      </div>
      {message.fileReferences && message.fileReferences.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 4, maxWidth: '85%' }}>
          {message.fileReferences.map((ref) => (
            <FileTag
              key={ref.path}
              fileRef={ref}
              onClick={(filePath) => postMessage({ type: 'openFile', path: filePath })}
            />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: '0.7em', opacity: 0.4 }}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
        {!isUser && !message.isStreaming && message.tokenUsage && (
          <span
            title={`Input: ${message.tokenUsage.inputTokens.toLocaleString()} | Output: ${message.tokenUsage.outputTokens.toLocaleString()}`}
            style={{ fontSize: '0.65em', opacity: 0.35 }}
          >
            {message.tokenUsage.totalTokens.toLocaleString()} tok
          </span>
        )}
      </div>
    </div>
  );
});
