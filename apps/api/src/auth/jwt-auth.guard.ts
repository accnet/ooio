import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService, AuthenticatedRequest } from './auth.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly auth: AuthService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      headers: Record<string, string | string[] | undefined>;
    }>();
    const rawKey = request.headers['x-api-key'];
    if (typeof rawKey === 'string' && rawKey.trim()) {
      return this.authenticateApiKey(request, rawKey);
    }
    return super.canActivate(context);
  }

  private async authenticateApiKey(request: AuthenticatedRequest, rawKey: string): Promise<boolean> {
    const user = await this.auth.validateApiKey(rawKey);
    if (!user) {
      throw new UnauthorizedException('invalid API key');
    }
    request.user = user;
    return true;
  }
}
