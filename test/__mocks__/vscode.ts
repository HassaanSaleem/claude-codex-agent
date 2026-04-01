// Mock VS Code API for unit tests
export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  createWebviewPanel: () => ({
    webview: {
      html: '',
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      postMessage: () => Promise.resolve(true),
    },
    onDidDispose: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  createOutputChannel: () => ({
    appendLine: () => {},
    append: () => {},
    show: () => {},
    dispose: () => {},
  }),
  registerWebviewViewProvider: () => ({ dispose: () => {} }),
  createTerminal: () => ({ show: () => {}, sendText: () => {} }),
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultValue?: unknown) => defaultValue,
  }),
  workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  findFiles: async () => [] as Array<{ fsPath: string; scheme: string }>,
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  asRelativePath: (uri: any) => {
    const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
    return fsPath;
  },
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  joinPath: (base: any, ...segments: string[]) => ({ fsPath: [base.fsPath, ...segments].join('/'), scheme: 'file' }),
};

export enum ViewColumn {
  Beside = 2,
}
