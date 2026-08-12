import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { readSessionCookie, type AuthenticatedRequest } from './auth.types';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawToken = readSessionCookie(request);
    const auth = rawToken === undefined ? null : await this.authService.authenticate(rawToken);
    if (auth === null) {
      throw new HttpException(
        { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    request.auth = auth;
    return true;
  }
}
