import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateApiKey, hashApiKey } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
}

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, input: CreateApiKeyInput) {
    const name = input.name.trim();
    if (!name) {
      throw new Error('API key name is required');
    }
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }
    const key = generateApiKey();
    const apiKey = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name,
        keyHash: hashApiKey(key),
        scopes: input.scopes ? (input.scopes as Prisma.InputJsonValue) : undefined,
      },
    });
    return { id: apiKey.id, name: apiKey.name, key, createdAt: apiKey.createdAt };
  }

  async list(organizationId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(organizationId: string, keyId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, organizationId } });
    if (!key) {
      throw new NotFoundException('API key not found');
    }
    await this.prisma.apiKey.delete({ where: { id: key.id } });
    return { id: key.id, revoked: true };
  }
}
