import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DasModule } from '../das/das.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MigrationsController } from './migrations.controller';
import { MigrationsService } from './migrations.service';

@Module({
  imports: [PrismaModule, AuthModule, DasModule],
  controllers: [MigrationsController],
  providers: [MigrationsService],
  exports: [MigrationsService],
})
export class MigrationsModule {}
