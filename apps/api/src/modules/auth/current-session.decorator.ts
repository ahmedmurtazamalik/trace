import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedSession } from './auth.types';

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth === undefined) {
      throw new Error('CurrentSession requires SessionAuthGuard');
    }
    return request.auth;
  },
);
