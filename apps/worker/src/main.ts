import { startTraceWorkers } from './application';
import type { WorkerStop } from './shutdown-budget';
import { safeWorkerStartupError } from './startup-error';

let stopWorkers: WorkerStop | undefined;
let runtimeFailurePending = false;
const runtimeFailure = (): void => {
  process.exitCode = 1;
  runtimeFailurePending = true;
  void stopWorkers?.().catch(() => { process.exitCode = 1; });
};
void startTraceWorkers({ environment: process.env, onRuntimeFailure: runtimeFailure }).then((stop) => {
  stopWorkers = stop;
  if (runtimeFailurePending) void stop().catch(() => { process.exitCode = 1; });
  let stopping: Promise<void> | undefined;
  const onSignal = (): void => {
    stopping ??= stop().catch(() => { process.exitCode = 1; });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}).catch((error: unknown) => {
  console.error(safeWorkerStartupError(error));
  process.exitCode = 1;
});
