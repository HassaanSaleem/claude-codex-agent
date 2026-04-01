import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from '../../src/extension.js';

describe('Extension entry point', () => {
  it('exports activate and deactivate functions', () => {
    expect(typeof activate).toBe('function');
    expect(typeof deactivate).toBe('function');
  });

  it('registers all commands on activate', () => {
    const registeredCommands: string[] = [];
    vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((id: string) => {
      registeredCommands.push(id);
      return { dispose: () => {} };
    });

    const stateStore = new Map<string, any>();
    const mockContext = {
      subscriptions: [] as any[],
      extensionUri: { fsPath: '/mock' },
      workspaceState: {
        get: (key: string) => stateStore.get(key),
        update: (key: string, value: any) => { stateStore.set(key, value); return Promise.resolve(); },
      },
    } as any;

    activate(mockContext);

    expect(registeredCommands).toContain('claudeCodex.startPipeline');
    expect(registeredCommands).toContain('claudeCodex.cancelPipeline');
    expect(registeredCommands).toContain('claudeCodex.viewHistory');
    expect(registeredCommands).toContain('claudeCodex.viewRun');
    // 4 commands + 1 sidebar view provider + 1 onDidChangeConfiguration listener + 1 FileReferenceService dispose + 1 onDidChangeActiveTextEditor
    expect(mockContext.subscriptions.length).toBe(8);
  });
});
