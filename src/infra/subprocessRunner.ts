import { spawn, execFile, type ChildProcess } from 'node:child_process';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Build a clean environment for spawning CLI subprocesses.
 * Strips CLAUDECODE to prevent "nested session" detection when spawning
 * Claude Code CLI from within a VS Code extension host that has
 * Claude Code IDE integration active.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

export interface StreamingHandle {
  process: ChildProcess;
  result: Promise<SpawnResult>;
  kill: () => void;
}

/**
 * Spawn a long-running CLI process with streaming stdout/stderr capture.
 * Used for Claude Code CLI and Codex CLI invocations.
 */
export function spawnStreaming(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    stdin?: string;
    signal?: AbortSignal;
  },
): StreamingHandle {
  const proc = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv(),
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  proc.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    stdout += chunk;
    options.onStdout?.(chunk);
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    stderr += chunk;
    options.onStderr?.(chunk);
  });

  if (options.stdin !== undefined) {
    proc.stdin?.write(options.stdin);
    proc.stdin?.end();
  }

  // Kill on external abort signal (pipeline-level timeout)
  if (options.signal) {
    if (options.signal.aborted) {
      timedOut = true;
      proc.kill('SIGTERM');
    } else {
      options.signal.addEventListener('abort', () => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, { once: true });
    }
  }

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGTERM');
  }, options.timeoutMs);

  const result = new Promise<SpawnResult>((resolve) => {
    proc.on('close', (code) => {
      clearTimeout(timeoutHandle);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutHandle);
      resolve({
        stdout,
        stderr: stderr + '\n' + err.message,
        exitCode: err.message.includes('ENOENT') ? 127 : 1,
        timedOut: false,
      });
    });
  });

  return {
    process: proc,
    result,
    kill: () => {
      if (proc.exitCode !== null) return; // already exited
      proc.kill('SIGTERM');
      // Escalate to SIGKILL if process doesn't exit within 5s
      const sigkillTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* process may have exited */ }
      }, 5000);
      proc.on('close', () => clearTimeout(sigkillTimer));
    },
  };
}

/**
 * Run a short-lived command and capture its output.
 * Used for gate commands (test, lint, typecheck, security scan).
 */
export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: cleanEnv(),
        signal: options.signal,
      }, (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0, timedOut: false });
          return;
        }
        const errnoErr = error as NodeJS.ErrnoException;
        const timedOut = (error as any).killed === true || error.message.includes('TIMEOUT');
        const exitCode = errnoErr.code === 'ENOENT' ? 127 : ((error as any).status ?? 1);
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode,
          timedOut,
        });
      });
    } catch (err) {
      resolve({ stdout: '', stderr: String(err), exitCode: 1, timedOut: false });
    }
  });
}

/**
 * Parse a command string into executable and arguments.
 * E.g., "python -m pytest" -> ["python", ["-m", "pytest"]]
 */
export function parseCommand(commandStr: string): [string, string[]] {
  const parts = commandStr.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  return [cmd, args];
}
