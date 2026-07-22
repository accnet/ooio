import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './auth.service';

export const PLATFORM_ROLE_KEY = 'platformRole';

export const PlatformRole = (role: string) => SetMetadata(PLATFORM_ROLE_KEY, role);

@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<string>(PLATFORM_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRole) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.platformRoles?.includes(requiredRole)) {
      throw new ForbiddenException(`platform role '${requiredRole}' is required`);
    }
    return true;
  }
}
