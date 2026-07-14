import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Persistent OTA state under `<dataDir>/ota/state.json`.
 * Written atomically (temp file + rename). Read defensively with a fallback.
 */
export interface OtaState {
  activeVersion: string | null;
  bootAttempts: number;
  lastGoodAt: string | null;
  quarantined: string[];
}

const DEFAULT_STATE: OtaState = {
  activeVersion: null,
  bootAttempts: 0,
  lastGoodAt: null,
  quarantined: [],
};

export function otaDir(dataDir: string): string {
  return path.join(dataDir, "ota");
}
export function statePath(dataDir: string): string {
  return path.join(otaDir(dataDir), "state.json");
}
export function activeDir(dataDir: string): string {
  return path.join(otaDir(dataDir), "active");
}
export function stagingDir(dataDir: string): string {
  return path.join(otaDir(dataDir), "staging");
}

export async function readState(dataDir: string): Promise<OtaState> {
  try {
    const raw = await fs.readFile(statePath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<OtaState>;
    return {
      activeVersion:
        typeof parsed.activeVersion === "string" ? parsed.activeVersion : null,
      bootAttempts:
        Number.isFinite(parsed.bootAttempts) && (parsed.bootAttempts as number) >= 0
          ? Math.floor(parsed.bootAttempts as number)
          : 0,
      lastGoodAt: typeof parsed.lastGoodAt === "string" ? parsed.lastGoodAt : null,
      quarantined: Array.isArray(parsed.quarantined)
        ? parsed.quarantined.filter((v): v is string => typeof v === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeState(dataDir: string, state: OtaState): Promise<void> {
  await fs.mkdir(otaDir(dataDir), { recursive: true });
  const tmp = `${statePath(dataDir)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, statePath(dataDir));
}

export async function markHealthy(dataDir: string): Promise<void> {
  const state = await readState(dataDir);
  state.bootAttempts = 0;
  state.lastGoodAt = new Date().toISOString();
  await writeState(dataDir, state);
}

export async function quarantine(dataDir: string, version: string | null): Promise<void> {
  const state = await readState(dataDir);
  if (version && !state.quarantined.includes(version)) {
    state.quarantined.push(version);
  }
  state.activeVersion = null;
  state.bootAttempts = 0;
  await writeState(dataDir, state);
  // Neutralize the active payload so the loader falls back to the image.
  await fs.rm(activeDir(dataDir), { recursive: true, force: true });
}
