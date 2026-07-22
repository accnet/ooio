export const MIGRATION_STATES = [
  'planned',
  'restoring',
  'freezing',
  'catching-up',
  'verifying',
  'switching',
  'acked',
  'completed',
  'aborted',
] as const;

export type MigrationState = (typeof MIGRATION_STATES)[number];

export interface CreateMigrationInput {
  toPoolId: string;
  reason: string;
}

export interface AcknowledgeMigrationInput {
  nodeId: string;
  epoch: number;
}

export interface MigrationRecord {
  id: string;
  storeId: string;
  fromPoolId: string;
  toPoolId: string;
  state: MigrationState;
  epoch: number | null;
  ackedNodes: unknown;
  reason: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
