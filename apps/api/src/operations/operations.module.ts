import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [AuthModule, WorkflowModule],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
