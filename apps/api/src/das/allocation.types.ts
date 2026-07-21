export const DB_POOL_STATUSES = [
  'provisioning',
  'healthy',
  'draining',
  'maintenance',
  'retiring',
  'deleted',
] as const;

export type DbPoolStatus = (typeof DB_POOL_STATUSES)[number];

export interface AllocateDatabaseInput {
  storeId: string;
  clusterId: string;
}

export interface DatabaseAllocation {
  poolId: string;
  dataset: string;
  connectionRef: string;
  epoch: number;
}

export interface RegisterPoolInput {
  clusterId: string;
  name: string;
  host: string;
  port?: number;
  databaseName: string;
  username: string;
  secretRef?: string;
  capacity?: number;
  status?: DbPoolStatus;
}
