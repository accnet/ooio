import { ConfigService } from '@nestjs/config';

export interface PlacementWeights {
  cpu: number;
  memory: number;
  disk: number;
  stores: number;
}

export interface PlacementConfig {
  maxStoresPerNode: number;
  maxCpuPercent: number;
  maxMemoryPercent: number;
  heartbeatMaxAgeSeconds: number;
  weights: PlacementWeights;
  reconciliationIntervalMs: number;
}

function numberConfig(config: ConfigService, name: string, fallback: number): number {
  const value = Number(config.get<string | number>(name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function loadPlacementConfig(config: ConfigService): PlacementConfig {
  return {
    maxStoresPerNode: Math.max(1, numberConfig(config, 'PLACEMENT_MAX_STORES_PER_NODE', 100)),
    maxCpuPercent: Math.min(100, Math.max(1, numberConfig(config, 'PLACEMENT_MAX_CPU_PERCENT', 80))),
    maxMemoryPercent: Math.min(100, Math.max(1, numberConfig(config, 'PLACEMENT_MAX_MEMORY_PERCENT', 90))),
    heartbeatMaxAgeSeconds: Math.max(1, numberConfig(config, 'PLACEMENT_HEARTBEAT_MAX_AGE_SECONDS', 120)),
    weights: {
      cpu: Math.max(0, numberConfig(config, 'PLACEMENT_WEIGHT_CPU', 0.45)),
      memory: Math.max(0, numberConfig(config, 'PLACEMENT_WEIGHT_MEMORY', 0.3)),
      disk: Math.max(0, numberConfig(config, 'PLACEMENT_WEIGHT_DISK', 0.15)),
      stores: Math.max(0, numberConfig(config, 'PLACEMENT_WEIGHT_STORES', 0.1)),
    },
    reconciliationIntervalMs: Math.max(1000, numberConfig(config, 'RECONCILIATION_INTERVAL_MS', 30000)),
  };
}
