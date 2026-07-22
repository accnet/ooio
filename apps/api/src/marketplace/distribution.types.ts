export const DISTRIBUTION_CHANNELS = ['stable', 'beta'] as const;
export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];

export const DISTRIBUTION_STATUSES = ['draft', 'published', 'deprecated'] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

export interface CreateDistributionInput {
  name: string;
  version: string;
  channel?: DistributionChannel;
  artifactUrl: string;
  checksum: string;
}

export interface DistributionFilters {
  name?: string;
  channel?: DistributionChannel;
  status?: DistributionStatus;
}

export interface DeployDistributionInput {
  distributionId: string;
}
