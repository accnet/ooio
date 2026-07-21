import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedRequest } from './auth.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      params: Record<string, string | undefined>;
    }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('authentication required');
    }
    const organizationId = request.params.id;
    if (!organizationId) {
      throw new ForbiddenException('organization context is required');
    }

    if (user.authType === 'api-key') {
      if (user.organizationId !== organizationId) {
        throw new ForbiddenException('API key is not valid for this organization');
      }
      return true;
    }

    if (!user.userId) {
      throw new ForbiddenException('user context is required');
    }
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.userId } },
    });
    if (!membership || !roles.includes(membership.role)) {
      throw new ForbiddenException('insufficient organization role');
    }
    request.user.organizationId = organizationId;
    return true;
  }
}
