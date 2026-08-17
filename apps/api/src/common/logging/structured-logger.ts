import type { LoggerService, LogLevel } from '@nestjs/common';
import type { TraceConfig } from '@trace/config';

export type StructuredLogWriter = (line: string) => void;
type TraceLogLevel = TraceConfig['logLevel'];

const priorities: Record<LogLevel, number> = {
  fatal: 0,
  error: 0,
  warn: 1,
  log: 2,
  debug: 3,
  verbose: 3,
};
const configuredPriorities: Record<TraceLogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export class StructuredLogger implements LoggerService {
  private threshold: number;

  constructor(
    level: TraceLogLevel,
    private readonly write: StructuredLogWriter = (line) => process.stdout.write(line),
    private readonly timestamp: () => string = () => new Date().toISOString(),
  ) {
    this.threshold = configuredPriorities[level];
  }

  log(message: unknown, ...optionalParams: unknown[]): void { this.emit('log', message, optionalParams); }
  error(message: unknown, ...optionalParams: unknown[]): void { this.emit('error', message, optionalParams); }
  warn(message: unknown, ...optionalParams: unknown[]): void { this.emit('warn', message, optionalParams); }
  debug(message: unknown, ...optionalParams: unknown[]): void { this.emit('debug', message, optionalParams); }
  verbose(message: unknown, ...optionalParams: unknown[]): void { this.emit('verbose', message, optionalParams); }
  fatal(message: unknown, ...optionalParams: unknown[]): void { this.emit('fatal', message, optionalParams); }

  setLogLevels(levels: LogLevel[]): void {
    this.threshold = levels.reduce((maximum, level) => Math.max(maximum, priorities[level]), -1);
  }

  private emit(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    if (priorities[level] > this.threshold) return;
    const contextCandidate = optionalParams.at(-1);
    const context = typeof contextCandidate === 'string' ? contextCandidate : undefined;
    const fields = this.fields(message);
    const record = {
      ...fields,
      timestamp: this.timestamp(),
      level: level === 'log' ? 'info' : level,
      ...(context === undefined ? {} : { context }),
    };
    try {
      this.write(`${JSON.stringify(record)}\n`);
    } catch {
      this.write(`${JSON.stringify({ timestamp: this.timestamp(), level: 'error', message: 'Log serialization failed.' })}\n`);
    }
  }

  private fields(message: unknown): Record<string, unknown> {
    if (message instanceof Error) return { message: message.message, errorName: message.name };
    if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
      return { ...(message as Record<string, unknown>) };
    }
    return { message: String(message) };
  }
}
