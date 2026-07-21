import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
}

@Injectable()
export class OrgsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser) {
    if (user.authType === 'api-key') {
      return this.prisma.organization.findMany({ where: { id: user.organizationId } });
    }
    if (!user.userId) {
      throw new UnauthorizedException('user context is required');
    }
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map(({ organization, role }) => ({ ...organization, role }));
  }

  async create(input: CreateOrganizationInput, user: AuthenticatedUser) {
    if (!user.userId) {
      throw new UnauthorizedException('only users can create organizations');
    }
    const name = input.name.trim();
    if (!name) {
      throw new Error('organization name is required');
    }
    const slug = input.slug?.trim().toLowerCase() || `${this.slugify(name)}-${randomBytes(4).toString('hex')}`;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
      throw new Error('slug must contain only lowercase letters, numbers, and hyphens');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({ data: { name, slug } });
        await tx.membership.create({
          data: { organizationId: organization.id, userId: user.userId as string, role: 'owner' },
        });
        return { ...organization, role: 'owner' };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('organization slug is already in use');
      }
      throw error;
    }
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'organization';
  }
}
