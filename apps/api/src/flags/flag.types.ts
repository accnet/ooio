export interface FeatureFlagRules {
  org?: Record<string, boolean | { enabled: boolean }>;
  plan?: Record<string, boolean | { enabled: boolean }>;
  cluster?: Record<string, boolean | { enabled: boolean }>;
  version?: Record<string, boolean | { enabled: boolean }>;
  default?: boolean;
  [key: string]: unknown;
}

export interface UpsertFeatureFlagInput {
  description?: string;
  enabled?: boolean;
  rules?: FeatureFlagRules;
}

export interface FeatureFlagEvaluationQuery {
  key?: string;
  orgId?: string;
  clusterId?: string;
  version?: string;
}
