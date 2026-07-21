import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WORKFLOW_QUEUE, WorkflowService } from './workflow.service';

interface WorkflowJobData {
  operationId: string;
}

@Processor(WORKFLOW_QUEUE)
export class OperationsProcessor extends WorkerHost {
  constructor(private readonly workflow: WorkflowService) {
    super();
  }

  async process(job: Job<WorkflowJobData>): Promise<void> {
    if (job.name === 'retry-operation') {
      await this.workflow.requeueOperation(job.data.operationId);
      return;
    }
    if (job.name === 'dispatch-operation') {
      await this.workflow.dispatchOperation(job.data.operationId);
    }
  }
}
