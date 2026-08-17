export const DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS = 210_000;
export type WorkerStop = (deadline?: number) => Promise<void>;

export function workerShutdownTimeoutMs(environment: NodeJS.ProcessEnv): number {
  const raw = environment.WORKER_SHUTDOWN_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > 600_000) {
    throw new Error('WORKER_SHUTDOWN_TIMEOUT_MS must be an integer between 10000 and 600000.');
  }
  return parsed;
}

export function workerShutdownDeadline(environment: NodeJS.ProcessEnv): number {
  return Date.now() + workerShutdownTimeoutMs(environment);
}

export function workerDrainDeadline(shutdownDeadline: number): number {
  const remainingMs = Math.max(1, shutdownDeadline - Date.now());
  const forcedCleanupReserveMs = Math.min(10_000, Math.max(1, Math.floor(remainingMs / 10)));
  return shutdownDeadline - forcedCleanupReserveMs;
}

export async function beforeWorkerDeadline<T>(operation: Promise<T>, deadline: number, message: string): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error(message);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), remainingMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
