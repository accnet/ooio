import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlagsController } from './flags.controller';
import { FlagsService } from './flags.service';

@Module({
  imports: [AuthModule],
  controllers: [FlagsController],
  providers: [FlagsService],
  exports: [FlagsService],
})
export class FlagsModule {}
