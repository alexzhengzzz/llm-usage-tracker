import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AliQuotaConfig {
  limit: number;
  threshold: number;
}

interface BreakerState {
  enabled: boolean;
}

function statePath(): string {
  return process.env.ALI_BREAKER_STATE_PATH || path.join(os.homedir(), '.llm-usage-tracker', 'ali-breaker-state.json');
}

function readEnabled(): boolean {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Partial<BreakerState>;
    return typeof state.enabled === 'boolean' ? state.enabled : true;
  } catch {
    return true;
  }
}

let breakerEnabled = readEnabled();

export function getAliQuotaConfig(): AliQuotaConfig {
  const limit = Number.parseInt(process.env.ALI_DAILY_TOKEN_LIMIT || '100000000', 10);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100000000;
  const configuredThreshold = Number.parseInt(
    process.env.ALI_QUOTA_THRESHOLD || String(Math.floor(safeLimit * 0.9)),
    10,
  );
  return {
    limit: safeLimit,
    threshold: Number.isFinite(configuredThreshold) && configuredThreshold > 0
      ? configuredThreshold
      : Math.floor(safeLimit * 0.9),
  };
}

export function isAliBreakerEnabled(): boolean {
  return breakerEnabled;
}

export function setAliBreakerEnabled(enabled: boolean): void {
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ enabled } satisfies BreakerState)}\n`, 'utf8');
  fs.renameSync(temporary, target);
  breakerEnabled = enabled;
}

export function toggleAliBreaker(): boolean {
  const enabled = !breakerEnabled;
  setAliBreakerEnabled(enabled);
  return enabled;
}
