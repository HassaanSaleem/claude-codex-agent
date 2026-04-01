import React, { useState } from 'react';
import { useMessageHandler } from './hooks/useMessageHandler.js';
import { postMessage } from './hooks/useVsCodeApi.js';
import { TaskInput } from './components/TaskInput.js';
import { ProgressBar } from './components/ProgressBar.js';
import { StreamingOutput } from './components/StreamingOutput.js';
import { GateResults } from './components/GateResults.js';
import { StatusBadge } from './components/StatusBadge.js';
import { PlanView } from './components/PlanView.js';
import { DiffView } from './components/DiffView.js';
import { AuditView } from './components/AuditView.js';
import { RunHistory } from './components/RunHistory.js';
import { PlanApprovalDialog } from './components/PlanApprovalDialog.js';
import { ClarificationDialog } from './components/ClarificationDialog.js';

type Tab = 'output' | 'plan' | 'diff' | 'gates' | 'audit' | 'pr' | 'history';

const TAB_LABELS: Record<Tab, string> = {
  output: 'Output',
  plan: 'Plan',
  diff: 'Diff',
  gates: 'Gates',
  audit: 'Audit',
  pr: 'PR Description',
  history: 'History',
};

function TabBar({ active, onSelect, tabs }: { active: Tab; onSelect: (t: Tab) => void; tabs: Tab[] }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onSelect(tab)}
          style={{
            padding: '6px 14px',
            background: active === tab ? 'var(--input-bg)' : 'transparent',
            color: active === tab ? 'var(--foreground)' : 'var(--foreground)',
            opacity: active === tab ? 1 : 0.6,
            borderBottom: active === tab ? '2px solid var(--button-bg)' : '2px solid transparent',
            borderRadius: 0,
            fontSize: '0.85em',
            fontWeight: active === tab ? 600 : 400,
          }}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
}

export function PipelineApp() {
  const [state, dispatch] = useMessageHandler();
  const [activeTab, setActiveTab] = useState<Tab>('output');

  const handleTabSelect = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'history' && state.runHistory.length === 0) {
      postMessage({ type: 'viewHistory' });
    }
  };

  const handlePatchBudgetResponse = (approved: boolean) => {
    postMessage({ type: 'approvePatchBudget', approved });
    dispatch({ type: 'DISMISS_PATCH_BUDGET' });
  };

  const handlePlanApprove = () => {
    postMessage({ type: 'humanApproval', decision: 'approve' });
    dispatch({ type: 'DISMISS_HUMAN_APPROVAL' });
  };

  const handlePlanReplan = (additionalContext: string) => {
    postMessage({ type: 'humanApproval', decision: 'edit_and_replan', additionalContext });
    dispatch({ type: 'DISMISS_HUMAN_APPROVAL' });
  };

  const handleClarificationSubmit = (answers: { questionId: string; answer: string }[]) => {
    postMessage({ type: 'answerClarification', answers });
    dispatch({ type: 'DISMISS_CLARIFICATION' });
  };

  const hasRunData = state.isRunning || state.runComplete;
  const tabs: Tab[] = hasRunData
    ? ['output', 'plan', 'diff', 'gates', 'audit', 'pr', 'history']
    : ['output', 'history'];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'output':
        return (
          <>
            <StreamingOutput output={state.streamOutput} currentStage={state.currentStage} />
            {state.gateResults.length > 0 && <GateResults results={state.gateResults} />}
          </>
        );
      case 'plan':
        return <PlanView planText={state.stageOutputs['plan'] ?? ''} />;
      case 'diff':
        return <DiffView diff={state.stageOutputs['implement'] ?? ''} />;
      case 'gates':
        return <GateResults results={state.gateResults} />;
      case 'audit':
        return <AuditView auditOutput={state.stageOutputs['audit'] ?? ''} />;
      case 'pr':
        return renderPrTab();
      case 'history':
        return (
          <RunHistory
            runs={state.runHistory}
            onViewRun={(runId) => postMessage({ type: 'viewRun', runId })}
            onRefresh={() => postMessage({ type: 'viewHistory' })}
          />
        );
      default:
        return null;
    }
  };

  const renderPrTab = () => {
    if (!state.runComplete) {
      return <div style={{ opacity: 0.6, padding: 12 }}>PR description will be available after pipeline completes.</div>;
    }
    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {state.runComplete.status === 'passed' && (
            <button
              className="primary"
              onClick={() => postMessage({ type: 'createPR', runId: state.runComplete!.runId })}
            >
              Create Pull Request
            </button>
          )}
        </div>
        <div style={{ opacity: 0.8 }}>
          <p>Run: <strong>{state.runComplete.runId}</strong></p>
          <p>Status: <StatusBadge status={state.runComplete.status} /></p>
          <p style={{ marginTop: 8 }}>{state.runComplete.summary}</p>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '0 12px 12px', maxWidth: 800 }}>
      <h2 style={{ padding: '12px 0 4px', fontSize: '1.2em' }}>ClaudeCodex Pipeline</h2>

      <TaskInput isRunning={state.isRunning} />

      {hasRunData && (
        <ProgressBar
          stageStatuses={state.stageStatuses}
          currentStage={state.currentStage}
        />
      )}

      {state.patchBudgetPrompt && (
        <div
          style={{
            border: '1px solid var(--warning-fg)',
            borderRadius: 3,
            padding: 12,
            margin: '12px 0',
            background: 'var(--input-bg)',
          }}
        >
          <h3 style={{ color: 'var(--warning-fg)', marginBottom: 8, fontSize: '1em' }}>
            Patch Budget Exceeded
          </h3>
          <p style={{ marginBottom: 8 }}>
            Changes: <strong>{state.patchBudgetPrompt.linesChanged}</strong> lines
            (budget: {state.patchBudgetPrompt.budget})
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={() => handlePatchBudgetResponse(true)}>
              Approve &amp; Continue
            </button>
            <button className="secondary" onClick={() => handlePatchBudgetResponse(false)}>
              Reject &amp; Cancel
            </button>
          </div>
        </div>
      )}

      {state.clarificationRequest && (
        <ClarificationDialog
          questions={state.clarificationRequest}
          onSubmit={handleClarificationSubmit}
        />
      )}

      {state.humanApprovalRequest && (
        <PlanApprovalDialog
          planText={state.humanApprovalRequest.planText}
          reviewFeedback={state.humanApprovalRequest.reviewFeedback}
          onApprove={handlePlanApprove}
          onEditAndReplan={handlePlanReplan}
        />
      )}

      <TabBar active={activeTab} onSelect={handleTabSelect} tabs={tabs} />

      {renderTabContent()}

      {state.runComplete && activeTab === 'output' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: 12,
            margin: '12px 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h3 style={{ fontSize: '1em' }}>Pipeline Complete</h3>
            <StatusBadge status={state.runComplete.status} />
          </div>
          <p style={{ opacity: 0.8 }}>{state.runComplete.summary}</p>
        </div>
      )}

      {state.error && (
        <div
          style={{
            border: '1px solid var(--error-fg)',
            borderRadius: 3,
            padding: 12,
            margin: '12px 0',
            color: 'var(--error-fg)',
          }}
        >
          <strong>Error:</strong> {state.error}
        </div>
      )}
    </div>
  );
}
