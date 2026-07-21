import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
  redis: 'not_checked';
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok', redis: 'not_checked' };
    } catch {
      return { status: 'error', db: 'error', redis: 'not_checked' };
    }
  }
}
