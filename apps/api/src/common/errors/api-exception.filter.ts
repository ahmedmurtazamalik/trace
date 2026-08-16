import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestWithId } from '../middleware/request-id.middleware';

const defaultCodes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

interface ExceptionBody {
  code?: string;
  message?: string | string[];
  fieldErrors?: Record<string, string[]>;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & RequestWithId>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = this.normalizeExceptionBody(exceptionResponse);
    const requestId = request.requestId ?? request.header('x-request-id') ?? 'unknown';

    if (!(exception instanceof HttpException)) {
      const type = exception instanceof Error ? exception.name : 'UnknownError';
      this.logger.error(`Unhandled request exception (requestId=${requestId}, type=${type})`);
    }

    const requestedCode = body.code ?? defaultCodes[status] ?? 'INTERNAL_SERVER_ERROR';
    const code = status >= 500 && requestedCode !== 'DEPENDENCIES_UNAVAILABLE'
      ? defaultCodes[status] ?? 'INTERNAL_SERVER_ERROR'
      : requestedCode;

    response.status(status).json({
      code,
      message: this.messageFor(status, code, body.message),
      requestId,
      ...(status < 500 && body.fieldErrors !== undefined ? { fieldErrors: body.fieldErrors } : {}),
    });
  }

  private normalizeExceptionBody(value: string | object | undefined): ExceptionBody {
    if (typeof value === 'string') {
      return { message: value };
    }
    if (value !== undefined && value !== null) {
      return value as ExceptionBody;
    }
    return {};
  }

  private messageFor(status: number, code: string, message: string | string[] | undefined): string {
    if (status >= 500) {
      return code === 'DEPENDENCIES_UNAVAILABLE'
        ? 'Required dependencies are unavailable.'
        : 'An internal server error occurred.';
    }
    if (Array.isArray(message)) {
      return 'Request validation failed.';
    }
    return message ?? 'Request failed.';
  }
}
