export function safeWorkerStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const allowlisted = [
    'Invalid Trace configuration:',
    'Invalid worker configuration:',
    'Invalid workspace analysis worker configuration.',
    'Workspace analysis worker startup failed.',
    'Trace activity worker startup failed.',
    'Trace report worker startup failed.',
    'Trace analysis worker startup failed.',
  ];
  return allowlisted.some((prefix) => message.startsWith(prefix))
    ? message
    : 'Trace workers failed to start.';
}
