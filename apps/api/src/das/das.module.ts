import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseAllocationService } from './das.service';
import { DasController } from './das.controller';

@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DasController],
  providers: [DatabaseAllocationService],
  exports: [DatabaseAllocationService],
})
export class DasModule {}
