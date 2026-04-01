import React, { useReducer, useEffect, useCallback } from 'react';
import type { AgentType, ChatMode, ChatMessage, ChatSession, ClarificationQuestion, CLIStatus, ExtensionMessage, FileAutocompleteEntry, StageName, TokenUsage } from '../domain/types.js';
import { postMessage } from './hooks/useVsCodeApi.js';
import { AgentSelector } from './components/AgentSelector.js';
import { ModeSelector } from './components/ModeSelector.js';
import { ModelSelector } from './components/ModelSelector.js';
import { ChatMessageList } from './components/ChatMessageList.js';
import { ChatInput as ChatInputComponent } from './components/ChatInput.js';
import { SessionList } from './components/SessionList.js';
import { WorkflowStageIndicator, buildInitialStages, type WorkflowStage } from './components/WorkflowStageIndicator.js';

function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

interface ChatState {
  messages: ChatMessage[];
  currentAgent: AgentType;
  currentMode: ChatMode;
  currentModel: string | null;
  isStreaming: boolean;
  error: string | null;
  workflowRunning: boolean;
  workflowStages: WorkflowStage[];
  currentWorkflowStage: StageName | null;
  // Session state
  sessions: ChatSession[];
  activeSessionId: string | null;
  showSessionList: boolean;
  cliStatus: CLIStatus | null;
  // File autocomplete state
  autocompleteFiles: FileAutocompleteEntry[];
  // Active editor file for auto-attach
  activeEditorFile: string | null;
  // Pinned files for current session (010-pinned-files)
  pinnedFiles: string[];
  // Session token totals (007-token-cost-tracking)
  sessionTokens: { input: number; output: number };
}

type ChatAction =
  | { type: 'ADD_USER_MESSAGE'; id: string; text: string }
  | { type: 'STREAM_CHUNK'; messageId: string; text: string }
  | { type: 'STREAM_END'; messageId: string; finalText: string }
  | { type: 'CHAT_ERROR'; messageId: string; error: string }
  | { type: 'SET_HISTORY'; messages: ChatMessage[]; mode?: ChatMode }
  | { type: 'SET_AGENT'; agent: AgentType }
  | { type: 'SET_MODE'; mode: ChatMode }
  | { type: 'SET_MODEL'; modelId: string | null }
  | { type: 'DISMISS_ERROR' }
  | { type: 'SET_STREAMING'; pendingAssistantId: string }
  | { type: 'CANCEL_STREAMING' }
  | { type: 'CLEAR_MESSAGES' }
  // Session actions
  | { type: 'SET_SESSIONS'; sessions: ChatSession[]; activeSessionId: string }
  | { type: 'SWITCH_SESSION'; sessionId: string; messages: ChatMessage[]; mode?: ChatMode }
  | { type: 'TOGGLE_SESSION_LIST' }
  // Workflow actions
  | { type: 'WORKFLOW_STAGE_START'; stageName: StageName; iteration: number; messageId: string }
  | { type: 'WORKFLOW_STREAM_CHUNK'; messageId: string; text: string }
  | { type: 'WORKFLOW_STAGE_END'; messageId: string; stageName: StageName }
  | { type: 'WORKFLOW_GATE_RESULT'; messageId: string; result: import('../domain/types.js').GateResult }
  | { type: 'WORKFLOW_REQUEST_APPROVAL'; messageId: string; planText: string; reviewFeedback: string }
  | { type: 'WORKFLOW_REQUEST_PATCH_BUDGET'; messageId: string; linesChanged: number; budget: number }
  | { type: 'WORKFLOW_COMPLETE'; status: import('../domain/types.js').PipelineStatus; summary: string; failedStage?: StageName }
  | { type: 'WORKFLOW_ERROR'; error: string }
  | { type: 'CANCEL_WORKFLOW' }
  | { type: 'WORKFLOW_RESET' }
  | { type: 'CLI_STATUS'; status: CLIStatus }
  // File reference actions
  | { type: 'FILE_LIST'; files: FileAutocompleteEntry[] }
  | { type: 'FILE_REFS_RESOLVED'; messageId: string; fileReferences: import('../domain/types.js').FileReference[] }
  // Thinking actions (004-webview-ux-overhaul)
  | { type: 'THINKING_CHUNK'; messageId: string; text: string }
  // Clarification (popup-style questions)
  | { type: 'CHAT_CLARIFICATION'; questions: ClarificationQuestion[] }
  // Active editor file
  | { type: 'SET_ACTIVE_EDITOR_FILE'; path: string | null }
  // Pinned files (010-pinned-files)
  | { type: 'SET_PINNED_FILES'; pinnedFiles: string[] }
  // Token usage (007-token-cost-tracking)
  | { type: 'TOKEN_USAGE'; messageId: string; usage: TokenUsage };

const initialState: ChatState = {
  messages: [],
  currentAgent: 'claude',
  currentMode: 'ask',
  currentModel: null,
  isStreaming: false,
  error: null,
  workflowRunning: false,
  workflowStages: [],
  currentWorkflowStage: null,
  sessions: [],
  activeSessionId: null,
  showSessionList: false,
  cliStatus: null,
  autocompleteFiles: [],
  activeEditorFile: null,
  pinnedFiles: [],
  sessionTokens: { input: 0, output: 0 },
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: 'user',
            content: action.text,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    case 'SET_STREAMING':
      return {
        ...state,
        isStreaming: true,
        error: null,
        messages: [
          ...state.messages,
          {
            id: action.pendingAssistantId,
            role: 'assistant' as const,
            agent: state.currentAgent,
            mode: state.currentMode,
            content: '',
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
      };
    case 'STREAM_CHUNK': {
      const exists = state.messages.some((m) => m.id === action.messageId);
      if (exists) {
        const msgs = state.messages.map((m) =>
          m.id === action.messageId ? { ...m, content: m.content + action.text } : m,
        );
        return { ...state, messages: msgs };
      }
      // First chunk — update the pending placeholder with the real messageId
      const pendingIdx = state.messages.findIndex((m) => m.isStreaming && m.content === '' && m.role === 'assistant');
      if (pendingIdx >= 0) {
        const msgs = [...state.messages];
        msgs[pendingIdx] = { ...msgs[pendingIdx], id: action.messageId, content: action.text };
        return { ...state, messages: msgs };
      }
      // Fallback — create a new assistant message
      return {
        ...state,
        isStreaming: true,
        messages: [
          ...state.messages,
          {
            id: action.messageId,
            role: 'assistant',
            agent: state.currentAgent,
            mode: state.currentMode,
            content: action.text,
            timestamp: new Date().toISOString(),
            isStreaming: true,
          },
        ],
      };
    }
    case 'STREAM_END': {
      const existsEnd = state.messages.some((m) => m.id === action.messageId);
      if (existsEnd) {
        const msgs = state.messages.map((m) =>
          m.id === action.messageId
            ? { ...m, content: action.finalText, isStreaming: false }
            : m,
        );
        return { ...state, messages: msgs, isStreaming: false };
      }
      // Update pending placeholder with final content
      const pendingEndIdx = state.messages.findIndex((m) => m.isStreaming && m.role === 'assistant');
      if (pendingEndIdx >= 0) {
        const msgs = [...state.messages];
        msgs[pendingEndIdx] = { ...msgs[pendingEndIdx], id: action.messageId, content: action.finalText, isStreaming: false };
        return { ...state, messages: msgs, isStreaming: false };
      }
      // Fallback — create completed message
      return {
        ...state,
        isStreaming: false,
        messages: [
          ...state.messages,
          {
            id: action.messageId,
            role: 'assistant',
            agent: state.currentAgent,
            content: action.finalText,
            timestamp: new Date().toISOString(),
            isStreaming: false,
          },
        ],
      };
    }
    case 'CHAT_ERROR': {
      const existsErr = state.messages.some((m) => m.id === action.messageId);
      if (existsErr) {
        const msgs = state.messages.map((m) =>
          m.id === action.messageId ? { ...m, isStreaming: false } : m,
        );
        return { ...state, messages: msgs, isStreaming: false, error: action.error };
      }
      return { ...state, isStreaming: false, error: action.error };
    }
    case 'SET_HISTORY': {
      // Always reset running states when loading history — persisted history
      // can never represent a running workflow, so force everything to idle.
      // Recalculate session tokens from loaded history
      const loadedTokens = action.messages.reduce(
        (acc, m) => m.tokenUsage
          ? { input: acc.input + m.tokenUsage.inputTokens, output: acc.output + m.tokenUsage.outputTokens }
          : acc,
        { input: 0, output: 0 },
      );
      return { ...state, messages: action.messages, isStreaming: false, workflowRunning: false, currentWorkflowStage: null, currentMode: action.mode ?? state.currentMode, currentModel: null, sessionTokens: loadedTokens };
    }
    case 'SET_AGENT': {
      // Reset mode to 'ask' when switching FROM workflow to another agent (safe default)
      const newMode = state.currentAgent === 'workflow' && action.agent !== 'workflow' ? 'ask' : state.currentMode;
      return { ...state, currentAgent: action.agent, currentMode: newMode, currentModel: null };
    }
    case 'SET_MODE':
      return { ...state, currentMode: action.mode };
    case 'SET_MODEL':
      return { ...state, currentModel: action.modelId };
    case 'DISMISS_ERROR':
      return { ...state, error: null };
    case 'CANCEL_STREAMING': {
      const msgs = state.messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m,
      );
      return { ...state, messages: msgs, isStreaming: false };
    }
    case 'CLEAR_MESSAGES':
      return { ...state, messages: [], isStreaming: false, error: null, workflowRunning: false, workflowStages: [], currentWorkflowStage: null, currentMode: 'ask', currentModel: null, sessionTokens: { input: 0, output: 0 }, pinnedFiles: [] };

    // ── Session actions ──
    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions, activeSessionId: action.activeSessionId };
    case 'SWITCH_SESSION': {
      const switchTokens = action.messages.reduce(
        (acc, m) => m.tokenUsage
          ? { input: acc.input + m.tokenUsage.inputTokens, output: acc.output + m.tokenUsage.outputTokens }
          : acc,
        { input: 0, output: 0 },
      );
      return { ...state, messages: action.messages, activeSessionId: action.sessionId, isStreaming: false, workflowRunning: false, workflowStages: [], currentWorkflowStage: null, error: null, currentMode: action.mode ?? state.currentMode, currentModel: null, sessionTokens: switchTokens, pinnedFiles: [] };
    }
    case 'TOGGLE_SESSION_LIST':
      return { ...state, showSessionList: !state.showSessionList };

    // ── Workflow actions ──
    case 'WORKFLOW_STAGE_START': {
      const baseStages = state.workflowStages.length > 0 ? state.workflowStages : buildInitialStages();
      const stages = baseStages.map((s) =>
        s.name === action.stageName ? { ...s, status: 'running' as const } : s,
      );
      return {
        ...state,
        workflowRunning: true,
        workflowStages: stages,
        currentWorkflowStage: action.stageName,
        messages: [
          ...state.messages,
          {
            id: action.messageId,
            role: 'assistant',
            agent: 'workflow',
            content: '',
            timestamp: new Date().toISOString(),
            isStreaming: true,
            metadata: { kind: 'stage_header', stageName: action.stageName, iteration: action.iteration },
          },
        ],
      };
    }
    case 'WORKFLOW_STREAM_CHUNK': {
      const msgs = state.messages.map((m) =>
        m.id === action.messageId ? { ...m, content: m.content + action.text } : m,
      );
      return { ...state, messages: msgs };
    }
    case 'WORKFLOW_STAGE_END': {
      const stages = state.workflowStages.map((s) =>
        s.name === action.stageName ? { ...s, status: 'completed' as const } : s,
      );
      const msgs = state.messages.map((m) =>
        m.id === action.messageId ? { ...m, isStreaming: false } : m,
      );
      return { ...state, workflowStages: stages, messages: msgs };
    }
    case 'WORKFLOW_GATE_RESULT':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.messageId,
            role: 'assistant',
            agent: 'workflow',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { kind: 'gate_result', result: action.result },
          },
        ],
      };
    case 'WORKFLOW_REQUEST_APPROVAL':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.messageId,
            role: 'assistant',
            agent: 'workflow',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { kind: 'approval_request', planText: action.planText, reviewFeedback: action.reviewFeedback },
          },
        ],
      };
    case 'WORKFLOW_REQUEST_PATCH_BUDGET':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.messageId,
            role: 'assistant',
            agent: 'workflow',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { kind: 'patch_budget_request', linesChanged: action.linesChanged, budget: action.budget },
          },
        ],
      };
    case 'WORKFLOW_COMPLETE': {
      // Clear any orphaned empty streaming messages (including the SET_STREAMING placeholder)
      const completedMsgs = state.messages
        .filter((m) => !(m.isStreaming && m.content === '' && m.role === 'assistant'))
        .map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
      return {
        ...state,
        workflowRunning: false,
        isStreaming: false,
        currentWorkflowStage: null,
        messages: [
          ...completedMsgs,
          {
            id: `wf-complete-${Date.now()}`,
            role: 'assistant',
            agent: 'workflow',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { kind: 'workflow_complete', status: action.status, summary: action.summary, failedStage: action.failedStage },
          },
        ],
      };
    }
    case 'WORKFLOW_ERROR': {
      // Mark any running stages as failed
      const failedStages = state.workflowStages.map((s) =>
        s.status === 'running' ? { ...s, status: 'failed' as const } : s,
      );
      const finishedMsgs = state.messages
        .filter((m) => !(m.isStreaming && m.content === '' && m.role === 'assistant'))
        .map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
      return {
        ...state,
        workflowRunning: false,
        isStreaming: false,
        workflowStages: failedStages,
        currentWorkflowStage: null,
        messages: finishedMsgs,
        error: action.error,
      };
    }
    case 'CANCEL_WORKFLOW': {
      const cancelledStages = state.workflowStages.map((s) =>
        s.status === 'running' ? { ...s, status: 'failed' as const } : s,
      );
      const cancelledMsgs = state.messages
        .filter((m) => !(m.isStreaming && m.content === '' && m.role === 'assistant'))
        .map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
      return {
        ...state,
        workflowRunning: false,
        isStreaming: false,
        workflowStages: cancelledStages,
        currentWorkflowStage: null,
        messages: cancelledMsgs,
      };
    }
    // Nuclear reset — "kill -9" for workflow state. Forces ALL running flags
    // to false regardless of current state. Sent by the extension's finally block
    // so it fires even if workflowComplete/workflowError was dropped or lost.
    case 'WORKFLOW_RESET': {
      const resetMsgs = state.messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m,
      );
      return {
        ...state,
        workflowRunning: false,
        isStreaming: false,
        currentWorkflowStage: null,
        messages: resetMsgs,
      };
    }

    case 'CLI_STATUS':
      return { ...state, cliStatus: action.status };

    // ── File reference actions ──
    case 'FILE_LIST':
      return { ...state, autocompleteFiles: action.files };
    case 'FILE_REFS_RESOLVED': {
      // Try exact messageId match first; fall back to most recent user message
      // (IDs diverge because webview uses `user-N` while extension uses hex IDs)
      let matched = false;
      const msgs = state.messages.map((m) => {
        if (m.id === action.messageId) {
          matched = true;
          return { ...m, fileReferences: action.fileReferences };
        }
        return m;
      });
      if (matched) return { ...state, messages: msgs };
      // Fallback: attach to the last user message
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'user') {
          const fallback = [...state.messages];
          fallback[i] = { ...fallback[i], fileReferences: action.fileReferences };
          return { ...state, messages: fallback };
        }
      }
      return state;
    }

    // Thinking chunk (004-webview-ux-overhaul)
    case 'THINKING_CHUNK': {
      const msgs = state.messages.map((m) =>
        m.id === action.messageId
          ? { ...m, thinkingContent: (m.thinkingContent ?? '') + action.text }
          : m,
      );
      return { ...state, messages: msgs };
    }

    // Chat clarification (popup-style questions from AskUserQuestion)
    case 'CHAT_CLARIFICATION':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `clarify-${Date.now()}`,
            role: 'assistant' as const,
            agent: 'claude' as const,
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { kind: 'clarification_request' as const, questions: action.questions },
          },
        ],
      };

    // Active editor file
    case 'SET_ACTIVE_EDITOR_FILE':
      return { ...state, activeEditorFile: action.path };

    // Pinned files (010-pinned-files)
    case 'SET_PINNED_FILES':
      return { ...state, pinnedFiles: action.pinnedFiles };

    // Token usage (007-token-cost-tracking)
    case 'TOKEN_USAGE': {
      // Subtract old usage if this message already had tokenUsage (avoid double-counting)
      const existing = state.messages.find((m) => m.id === action.messageId);
      const oldInput = existing?.tokenUsage?.inputTokens ?? 0;
      const oldOutput = existing?.tokenUsage?.outputTokens ?? 0;
      const msgs = state.messages.map((m) =>
        m.id === action.messageId ? { ...m, tokenUsage: action.usage } : m,
      );
      return {
        ...state,
        messages: msgs,
        sessionTokens: {
          input: state.sessionTokens.input - oldInput + action.usage.inputTokens,
          output: state.sessionTokens.output - oldOutput + action.usage.outputTokens,
        },
      };
    }

    default:
      return state;
  }
}

let messageCounter = 0;

export function ChatApp() {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  const isWorkflowMode = state.currentAgent === 'workflow';
  const cliReady = state.cliStatus === null || state.cliStatus.ready;
  const inputDisabled = state.isStreaming || state.workflowRunning || !cliReady;

  const handleMessage = useCallback((event: MessageEvent<ExtensionMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      // Chat messages
      case 'chatStreamChunk':
        dispatch({ type: 'STREAM_CHUNK', messageId: msg.messageId, text: msg.text });
        break;
      case 'chatStreamEnd':
        dispatch({ type: 'STREAM_END', messageId: msg.messageId, finalText: msg.finalText });
        break;
      case 'chatError':
        dispatch({ type: 'CHAT_ERROR', messageId: msg.messageId, error: msg.error });
        break;
      case 'chatHistory':
        dispatch({ type: 'SET_HISTORY', messages: msg.messages, mode: msg.mode });
        break;
      case 'agentChanged':
        dispatch({ type: 'SET_AGENT', agent: msg.agent });
        break;
      // Session messages
      case 'sessionsList':
        dispatch({ type: 'SET_SESSIONS', sessions: msg.sessions, activeSessionId: msg.activeSessionId });
        break;
      case 'sessionSwitched':
        dispatch({ type: 'SWITCH_SESSION', sessionId: msg.sessionId, messages: msg.messages, mode: msg.mode });
        break;
      // Workflow messages
      case 'workflowStageStart':
        dispatch({ type: 'WORKFLOW_STAGE_START', stageName: msg.stageName, iteration: msg.iteration, messageId: msg.messageId });
        break;
      case 'workflowStreamChunk':
        dispatch({ type: 'WORKFLOW_STREAM_CHUNK', messageId: msg.messageId, text: msg.text });
        break;
      case 'workflowStageEnd':
        dispatch({ type: 'WORKFLOW_STAGE_END', messageId: msg.messageId, stageName: msg.stageName });
        break;
      case 'workflowGateResult':
        dispatch({ type: 'WORKFLOW_GATE_RESULT', messageId: msg.messageId, result: msg.result });
        break;
      case 'workflowRequestApproval':
        dispatch({ type: 'WORKFLOW_REQUEST_APPROVAL', messageId: msg.messageId, planText: msg.planText, reviewFeedback: msg.reviewFeedback });
        break;
      case 'workflowRequestPatchBudget':
        dispatch({ type: 'WORKFLOW_REQUEST_PATCH_BUDGET', messageId: msg.messageId, linesChanged: msg.linesChanged, budget: msg.budget });
        break;
      case 'workflowComplete':
        dispatch({ type: 'WORKFLOW_COMPLETE', status: msg.status, summary: msg.summary, failedStage: msg.failedStage });
        break;
      case 'workflowError':
        dispatch({ type: 'WORKFLOW_ERROR', error: msg.error });
        break;
      case 'workflowReset':
        dispatch({ type: 'WORKFLOW_RESET' });
        break;
      // CLI status
      case 'cliStatus':
        dispatch({ type: 'CLI_STATUS', status: msg.status });
        break;
      // File reference messages
      case 'fileList':
        dispatch({ type: 'FILE_LIST', files: msg.files });
        break;
      case 'fileReferencesResolved':
        dispatch({ type: 'FILE_REFS_RESOLVED', messageId: msg.messageId, fileReferences: msg.fileReferences });
        break;
      // Thinking chunks (004-webview-ux-overhaul)
      case 'chatThinkingChunk':
        dispatch({ type: 'THINKING_CHUNK', messageId: msg.messageId, text: msg.text });
        break;
      // Chat clarification (popup-style questions from AskUserQuestion)
      case 'chatClarificationRequest':
        dispatch({ type: 'CHAT_CLARIFICATION', questions: msg.questions });
        break;
      // Chat mode (005-chat-modes)
      case 'modeChanged':
        dispatch({ type: 'SET_MODE', mode: msg.mode });
        break;
      // Model picker (008-model-picker)
      case 'modelChanged':
        dispatch({ type: 'SET_MODEL', modelId: msg.modelId || null });
        break;
      // Active editor file (auto-attach)
      case 'activeEditorFile':
        dispatch({ type: 'SET_ACTIVE_EDITOR_FILE', path: msg.path });
        break;
      // Token usage (007-token-cost-tracking)
      case 'chatTokenUsage':
        dispatch({ type: 'TOKEN_USAGE', messageId: msg.messageId, usage: msg.usage });
        break;
      // Pinned files (010-pinned-files)
      case 'pinnedFilesChanged':
        dispatch({ type: 'SET_PINNED_FILES', pinnedFiles: msg.pinnedFiles });
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    postMessage({ type: 'getChatHistory' });
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const handleSend = (text: string, fileReferences: { path: string }[], skipAutoAttach?: boolean) => {
    const userMsgId = `user-${++messageCounter}`;
    dispatch({ type: 'ADD_USER_MESSAGE', id: userMsgId, text });
    // In workflow mode, skip SET_STREAMING — the workflow has its own state
    // management (WORKFLOW_STAGE_START sets workflowRunning, WORKFLOW_COMPLETE resets it).
    // Dispatching SET_STREAMING in workflow mode creates an orphan placeholder that
    // keeps isStreaming=true even after the workflow finishes.
    if (!isWorkflowMode) {
      const assistantMsgId = `assistant-${++messageCounter}`;
      dispatch({ type: 'SET_STREAMING', pendingAssistantId: assistantMsgId });
    }
    postMessage({ type: 'sendChatMessage', text, fileReferences: fileReferences.length > 0 ? fileReferences : undefined, skipAutoAttach: skipAutoAttach || undefined });
  };

  const handleCancel = () => {
    if (state.workflowRunning) {
      dispatch({ type: 'CANCEL_WORKFLOW' });
      postMessage({ type: 'cancelWorkflow' });
    } else {
      dispatch({ type: 'CANCEL_STREAMING' });
      postMessage({ type: 'cancelChat' });
    }
  };

  const handleSwitchAgent = (agent: AgentType) => {
    dispatch({ type: 'SET_AGENT', agent });
    postMessage({ type: 'switchAgent', agent });
  };

  const handleRunPipeline = (taskDescription: string, fileReferences: { path: string }[]) => {
    postMessage({ type: 'requestPipeline', taskDescription, fileReferences: fileReferences.length > 0 ? fileReferences : undefined });
  };

  const handleNewChat = () => {
    dispatch({ type: 'CLEAR_MESSAGES' });
    postMessage({ type: 'newChat' });
  };

  const handleSwitchSession = (sessionId: string) => {
    if (sessionId === state.activeSessionId) return;
    postMessage({ type: 'switchSession', sessionId });
  };

  const handleDeleteSession = (sessionId: string) => {
    postMessage({ type: 'deleteSession', sessionId });
  };

  const handleRenameSession = (sessionId: string, title: string) => {
    postMessage({ type: 'renameSession', sessionId, title });
  };

  const handleToggleSessionList = () => {
    dispatch({ type: 'TOGGLE_SESSION_LIST' });
  };

  const handleSwitchMode = (mode: ChatMode) => {
    dispatch({ type: 'SET_MODE', mode });
    postMessage({ type: 'switchMode', mode });
  };

  const handleSwitchModel = (modelId: string | null) => {
    dispatch({ type: 'SET_MODEL', modelId });
    postMessage({ type: 'switchModel', modelId: modelId ?? '' });
  };

  const handlePinFile = (filePath: string) => {
    postMessage({ type: 'pinFile', path: filePath });
  };

  const handleUnpinFile = (filePath: string) => {
    postMessage({ type: 'unpinFile', path: filePath });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: '0.95em' }}>ClaudeCodex</span>
          {state.sessions.length > 0 && (
            <button
              onClick={handleToggleSessionList}
              title={state.showSessionList ? 'Hide sessions' : 'Show sessions'}
              style={{
                background: state.showSessionList ? 'var(--button-bg)' : 'transparent',
                color: state.showSessionList ? 'var(--button-fg)' : 'var(--foreground)',
                padding: '2px 6px',
                fontSize: '0.8em',
                borderRadius: 3,
                opacity: state.showSessionList ? 1 : 0.6,
              }}
            >
              {'\u{1F4CB}'} {state.sessions.length}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleNewChat}
            disabled={inputDisabled}
            title="New Chat"
            style={{
              padding: '4px 10px',
              fontSize: '0.8em',
              background: 'var(--button-secondary-bg)',
              color: 'var(--button-secondary-fg)',
              borderRadius: 3,
            }}
          >
            + New
          </button>
          <AgentSelector
            currentAgent={state.currentAgent}
            onSwitch={handleSwitchAgent}
            disabled={inputDisabled}
          />
        </div>
      </div>

      {/* CLI validation warning banner */}
      {!cliReady && state.cliStatus && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--input-bg)',
            borderBottom: '1px solid var(--warning-fg, #e5a100)',
            color: 'var(--warning-fg, #e5a100)',
            fontSize: '0.85em',
            flexShrink: 0,
          }}
        >
          <strong>CLI validation failed</strong>
          {[state.cliStatus.claude, state.cliStatus.codex]
            .filter((r) => !r.valid)
            .map((r) => (
              <div key={r.cli} style={{ marginTop: 4 }}>
                {r.cli}: {r.error}
              </div>
            ))}
          <div style={{ marginTop: 6, fontSize: '0.9em', opacity: 0.8 }}>
            Install or upgrade the CLIs, then change settings to re-validate.
          </div>
        </div>
      )}

      {/* Session list (collapsible) */}
      {state.showSessionList && (
        <SessionList
          sessions={state.sessions}
          activeSessionId={state.activeSessionId}
          onSwitch={handleSwitchSession}
          onDelete={handleDeleteSession}
          onRename={handleRenameSession}
        />
      )}

      {/* Workflow stage indicator */}
      {state.workflowRunning && (
        <WorkflowStageIndicator stages={state.workflowStages} />
      )}

      {/* Messages */}
      <ChatMessageList messages={state.messages} />

      {/* Error banner */}
      {state.error && (
        <div
          style={{
            padding: '6px 12px',
            background: 'var(--input-bg)',
            borderTop: '1px solid var(--error-fg)',
            color: 'var(--error-fg)',
            fontSize: '0.85em',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <span>{state.error}</span>
          <button
            onClick={() => dispatch({ type: 'DISMISS_ERROR' })}
            style={{ background: 'transparent', color: 'var(--error-fg)', fontSize: '0.9em', padding: '2px 6px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Mode selector + Model selector + Token counter — hidden in workflow mode */}
      {!isWorkflowMode && (
        <div style={{ padding: '4px 8px 0', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ModeSelector
            currentMode={state.currentMode}
            onModeChange={handleSwitchMode}
            disabled={inputDisabled}
          />
          <ModelSelector
            currentAgent={state.currentAgent}
            currentModel={state.currentModel}
            onModelChange={handleSwitchModel}
            disabled={inputDisabled}
          />
          {(state.sessionTokens.input > 0 || state.sessionTokens.output > 0) && (
            <span
              title={`Input: ${state.sessionTokens.input.toLocaleString()} | Output: ${state.sessionTokens.output.toLocaleString()}`}
              style={{
                marginLeft: 'auto',
                fontSize: '0.7em',
                opacity: 0.5,
                whiteSpace: 'nowrap',
              }}
            >
              {formatTokenCount(state.sessionTokens.input + state.sessionTokens.output)} tokens
            </span>
          )}
        </div>
      )}

      {/* Input */}
      <ChatInputComponent
        isStreaming={inputDisabled}
        isWorkflowMode={isWorkflowMode}
        currentMode={state.currentMode}
        autocompleteFiles={state.autocompleteFiles}
        activeEditorFile={state.activeEditorFile}
        pinnedFiles={state.pinnedFiles}
        onSend={handleSend}
        onCancel={handleCancel}
        onRunPipeline={handleRunPipeline}
        onPinFile={handlePinFile}
        onUnpinFile={handleUnpinFile}
      />
    </div>
  );
}
