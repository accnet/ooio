import { ConflictException } from '@nestjs/common';
import { MigrationState } from './migration.types';

const NEXT_STATES: Record<MigrationState, readonly MigrationState[]> = {
  planned: ['restoring', 'aborted'],
  restoring: ['freezing', 'aborted'],
  freezing: ['catching-up', 'aborted'],
  'catching-up': ['verifying', 'aborted'],
  verifying: ['switching', 'aborted'],
  switching: ['acked', 'aborted'],
  acked: ['completed', 'aborted'],
  completed: [],
  aborted: [],
};

export function assertMigrationTransition(from: MigrationState, to: MigrationState): void {
  if (!NEXT_STATES[from]?.includes(to)) {
    throw new ConflictException(`invalid migration state transition: ${from} -> ${to}`);
  }
}

export function isMigrationTerminal(state: MigrationState): boolean {
  return state === 'completed' || state === 'aborted';
}

export function migrationState(value: unknown): MigrationState {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(NEXT_STATES, value)) {
    return value as MigrationState;
  }
  throw new ConflictException(`unknown migration state: ${String(value)}`);
}
