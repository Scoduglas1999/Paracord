let invokeLoader: Promise<((command: string, args?: Record<string, unknown>) => Promise<unknown>) | null> | null =
  null;
let flushInFlight = false;
const pendingLines: string[] = [];
const MAX_BUFFERED_LINES = 400;

function getGlobalInvoke():
  | ((command: string, args?: Record<string, unknown>) => Promise<unknown>)
  | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
    __TAURI__?: { core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
  };
  if (typeof win.__TAURI_INTERNALS__?.invoke === 'function') {
    return win.__TAURI_INTERNALS__.invoke;
  }
  if (typeof win.__TAURI__?.core?.invoke === 'function') {
    return win.__TAURI__.core.invoke;
  }
  return null;
}

async function getInvoke() {
  const globalInvoke = getGlobalInvoke();
  if (globalInvoke) return globalInvoke;
  if (!invokeLoader) {
    invokeLoader = import('@tauri-apps/api/core')
      .then((mod) => mod.invoke)
      .catch(() => null);
  }
  return invokeLoader;
}

function safeSerialize(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function flushClientDiagnostics() {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    const invoke = await getInvoke();
    if (!invoke) {
      pendingLines.length = 0;
      return;
    }
    while (pendingLines.length > 0) {
      const line = pendingLines.shift();
      if (!line) continue;
      try {
        await invoke('append_client_log', { line });
      } catch {
        // Keep logging non-fatal.
      }
    }
  } finally {
    flushInFlight = false;
  }
}

export async function getDesktopDiagnosticsLogPath(): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    const path = await invoke('get_client_log_path');
    return typeof path === 'string' ? path : null;
  } catch {
    return null;
  }
}

export function logVoiceDiagnostic(message: string, extra?: unknown) {
  const timestamp = new Date().toISOString();
  const serializedExtra = safeSerialize(extra);
  const line = serializedExtra.length > 0 ? `${timestamp} ${message} ${serializedExtra}` : `${timestamp} ${message}`;
  pendingLines.push(line);
  if (pendingLines.length > MAX_BUFFERED_LINES) {
    pendingLines.splice(0, pendingLines.length - MAX_BUFFERED_LINES);
  }
  void flushClientDiagnostics();
}

logVoiceDiagnostic('[voice] desktop diagnostics initialized');
