import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { csrfHeaderName } from '@trace/shared';
import { hashCsrfToken, hashesEqual } from './auth-tokens';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const supplied = request.header(csrfHeaderName);
    const expected = request.auth?.session.csrfTokenHash;
    if (supplied === undefined || expected === undefined || !hashesEqual(hashCsrfToken(supplied), expected)) {
      throw new HttpException(
        { code: 'CSRF_INVALID', message: 'The CSRF token is missing or invalid.' },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
