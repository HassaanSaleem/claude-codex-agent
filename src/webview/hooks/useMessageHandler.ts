import { useEffect, useCallback, useReducer } from 'react';
import type {
  ExtensionMessage,
  PipelineStatus,
  StageStatus,
  GateResult,
  PipelineRunSummary,
  PipelineRun,
  ClarificationQuestion,
  CLIStatus,
} from '../../domain/types.js';

export interface PipelineState {
  isRunning: boolean;
  currentStage: string | null;
  stageStatuses: Record<string, StageStatus>;
  streamOutput: string;
  stageOutputs: Record<string, string>;
  gateResults: GateResult[];
  runComplete: { runId: string; status: PipelineStatus; summary: string } | null;
  error: string | null;
  patchBudgetPrompt: { linesChanged: number; budget: number } | null;
  humanApprovalRequest: { planText: string; reviewFeedback: string } | null;
  clarificationRequest: ClarificationQuestion[] | null;
  runHistory: PipelineRunSummary[];
  runDetails: PipelineRun | null;
  cliStatus: CLIStatus | null;
}

type Action =
  | { type: 'STREAM_CHUNK'; stage: string; text: string }
  | { type: 'STAGE_UPDATE'; stage: string; status: StageStatus; message?: string }
  | { type: 'GATE_RESULT'; result: GateResult }
  | { type: 'RUN_COMPLETE'; runId: string; status: PipelineStatus; summary: string }
  | { type: 'RUN_HISTORY'; runs: PipelineRunSummary[] }
  | { type: 'RUN_DETAILS'; run: PipelineRun }
  | { type: 'CONFIRM_PATCH_BUDGET'; linesChanged: number; budget: number }
  | { type: 'REQUEST_HUMAN_APPROVAL'; planText: string; reviewFeedback: string }
  | { type: 'DISMISS_HUMAN_APPROVAL' }
  | { type: 'REQUEST_CLARIFICATION'; questions: ClarificationQuestion[] }
  | { type: 'DISMISS_CLARIFICATION' }
  | { type: 'ERROR'; message: string; stage?: string }
  | { type: 'START_PIPELINE' }
  | { type: 'DISMISS_PATCH_BUDGET' }
  | { type: 'CLI_STATUS'; status: CLIStatus };

const initialState: PipelineState = {
  isRunning: false,
  currentStage: null,
  stageStatuses: {},
  streamOutput: '',
  stageOutputs: {},
  gateResults: [],
  runComplete: null,
  error: null,
  patchBudgetPrompt: null,
  humanApprovalRequest: null,
  clarificationRequest: null,
  runHistory: [],
  runDetails: null,
  cliStatus: null,
};

function reducer(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case 'START_PIPELINE':
      return {
        ...initialState,
        isRunning: true,
      };
    case 'STREAM_CHUNK':
      return {
        ...state,
        currentStage: action.stage,
        streamOutput: state.streamOutput + action.text,
        stageOutputs: {
          ...state.stageOutputs,
          [action.stage]: (state.stageOutputs[action.stage] ?? '') + action.text,
        },
      };
    case 'STAGE_UPDATE':
      return {
        ...state,
        currentStage: action.stage,
        stageStatuses: { ...state.stageStatuses, [action.stage]: action.status },
      };
    case 'GATE_RESULT':
      return {
        ...state,
        gateResults: [...state.gateResults, action.result],
      };
    case 'RUN_COMPLETE':
      return {
        ...state,
        isRunning: false,
        runComplete: { runId: action.runId, status: action.status, summary: action.summary },
      };
    case 'RUN_HISTORY':
      return {
        ...state,
        runHistory: action.runs,
      };
    case 'RUN_DETAILS':
      return {
        ...state,
        runDetails: action.run,
      };
    case 'CONFIRM_PATCH_BUDGET':
      return {
        ...state,
        patchBudgetPrompt: { linesChanged: action.linesChanged, budget: action.budget },
      };
    case 'DISMISS_PATCH_BUDGET':
      return {
        ...state,
        patchBudgetPrompt: null,
      };
    case 'REQUEST_HUMAN_APPROVAL':
      return {
        ...state,
        humanApprovalRequest: { planText: action.planText, reviewFeedback: action.reviewFeedback },
      };
    case 'DISMISS_HUMAN_APPROVAL':
      return {
        ...state,
        humanApprovalRequest: null,
      };
    case 'REQUEST_CLARIFICATION':
      return {
        ...state,
        clarificationRequest: action.questions,
      };
    case 'DISMISS_CLARIFICATION':
      return {
        ...state,
        clarificationRequest: null,
      };
    case 'CLI_STATUS':
      return {
        ...state,
        cliStatus: action.status,
      };
    case 'ERROR':
      return {
        ...state,
        isRunning: false,
        error: action.message,
      };
    default:
      return state;
  }
}

export function useMessageHandler(): [PipelineState, React.Dispatch<Action>] {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleMessage = useCallback((event: MessageEvent<ExtensionMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'streamChunk':
        dispatch({ type: 'STREAM_CHUNK', stage: msg.stage, text: msg.text });
        break;
      case 'stageUpdate':
        dispatch({ type: 'STAGE_UPDATE', stage: msg.stage, status: msg.status, message: msg.message });
        break;
      case 'gateResult':
        dispatch({ type: 'GATE_RESULT', result: msg.result });
        break;
      case 'runComplete':
        dispatch({ type: 'RUN_COMPLETE', runId: msg.runId, status: msg.status, summary: msg.summary });
        break;
      case 'runHistory':
        dispatch({ type: 'RUN_HISTORY', runs: msg.runs });
        break;
      case 'runDetails':
        dispatch({ type: 'RUN_DETAILS', run: msg.run });
        break;
      case 'confirmPatchBudget':
        dispatch({ type: 'CONFIRM_PATCH_BUDGET', linesChanged: msg.linesChanged, budget: msg.budget });
        break;
      case 'requestHumanApproval':
        dispatch({ type: 'REQUEST_HUMAN_APPROVAL', planText: msg.planText, reviewFeedback: msg.reviewFeedback });
        break;
      case 'requestClarification':
        dispatch({ type: 'REQUEST_CLARIFICATION', questions: msg.questions });
        break;
      case 'cliStatus':
        dispatch({ type: 'CLI_STATUS', status: msg.status });
        break;
      case 'error':
        dispatch({ type: 'ERROR', message: msg.message, stage: msg.stage });
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  return [state, dispatch];
}
