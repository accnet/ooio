export const OPERATION_TYPES = [
  'create-store',
  'delete-store',
  'activate-plugin',
  'switch-theme',
  'create-user',
  'set-option',
  'backup-store',
  'restore-store',
  'issue-ssl',
  'DeployDistribution',
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];
export type OperationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface OperationLogEntry {
  event: string;
  at: string;
  actor?: string;
  status?: OperationStatus;
  message?: string;
  maxAttempts?: number;
  [key: string]: unknown;
}

export interface OperationPayload {
  [key: string]: unknown;
}

export interface JobErrorInput {
  code: string;
  message: string;
}

export interface JobResultInput {
  status: 'succeeded' | 'failed';
  result?: unknown;
  error?: JobErrorInput;
}

export function isOperationType(value: string): value is OperationType {
  return (OPERATION_TYPES as readonly string[]).includes(value);
}

export function agentJobType(type: OperationType): OperationType {
  return type;
}
