// src/bootstrap/loader.ts — IMAGE-only entrypoint (Docker CMD). NEVER OTA-updatable.
//
// Henne-Ei rule: this file imports ONLY node builtins. It must never import app
// code or node_modules, so a broken OTA payload can never drag the loader down.
// The actual app bundle is loaded at runtime via a dynamic import of a computed
// URL (opaque to esbuild, so it is NOT bundled in here).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const ENV_PREFIX = "FRITZBOXPRESENCE";
const MAX_BOOT_ATTEMPTS = 3;

function env(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}_${name}`];
}

const DATA_DIR = env("DATA_DIR") ?? "/data";
const CORE_VERSION = env("VERSION") ?? "0.0.0";

const otaDir = path.join(DATA_DIR, "ota");
const statePath = path.join(otaDir, "state.json");
const activeDir = path.join(otaDir, "active");
const activeMain = path.join(activeDir, "main.js");
const activeManifest = path.join(activeDir, "manifest.json");

// ---- minimal semver (duplicated on purpose; no app imports) ---------------
function parseCore(v: string): [number, number, number] {
  const core = v.trim().replace(/^v/iu, "").split(/[-+]/u)[0] ?? "";
  const p = core.split(".");
  const n = (s?: string): number => {
    const x = Number.parseInt(s ?? "0", 10);
    return Number.isFinite(x) && x >= 0 ? x : 0;
  };
  return [n(p[0]), n(p[1]), n(p[2])];
}
function compareCore(a: string, b: string): number {
  const pa = parseCore(a);
  const pb = parseCore(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i]! > pb[i]!) return 1;
    if (pa[i]! < pb[i]!) return -1;
  }
  return 0;
}

// ---- minimal state IO (sync; own copy) ------------------------------------
interface LoaderState {
  activeVersion: string | null;
  bootAttempts: number;
  lastGoodAt: string | null;
  quarantined: string[];
}
function readState(): LoaderState {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const o = JSON.parse(raw) as Partial<LoaderState>;
    return {
      activeVersion: typeof o.activeVersion === "string" ? o.activeVersion : null,
      bootAttempts: typeof o.bootAttempts === "number" && o.bootAttempts >= 0 ? Math.floor(o.bootAttempts) : 0,
      lastGoodAt: typeof o.lastGoodAt === "string" ? o.lastGoodAt : null,
      quarantined: Array.isArray(o.quarantined) ? o.quarantined.filter((v): v is string => typeof v === "string") : [],
    };
  } catch {
    return { activeVersion: null, bootAttempts: 0, lastGoodAt: null, quarantined: [] };
  }
}
function writeState(s: LoaderState): void {
  try {
    fs.mkdirSync(otaDir, { recursive: true });
    const tmp = `${statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
    fs.renameSync(tmp, statePath);
  } catch {
    /* best-effort */
  }
}
function quarantineActive(version: string | null): void {
  const s = readState();
  if (version && !s.quarantined.includes(version)) s.quarantined.push(version);
  s.activeVersion = null;
  s.bootAttempts = 0;
  writeState(s);
  try {
    fs.rmSync(activeDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ---- decision --------------------------------------------------------------
export type BundleTarget = "image" | "ota";
export interface Decision {
  target: BundleTarget;
  quarantine: boolean;
  reason: string;
}
export interface DecideInputs {
  hasBundle: boolean;
  manifestValid: boolean;
  hasMainSha: boolean;
  mainShaMatches: boolean;
  requiresCore: boolean;
  coreSupersedes: boolean;
  bootAttempts: number;
}

export function decideBundle(i: DecideInputs): Decision {
  if (!i.hasBundle) return { target: "image", quarantine: false, reason: "no-bundle" };
  if (!i.manifestValid) return { target: "image", quarantine: true, reason: "manifest-invalid" };
  if (i.hasMainSha && !i.mainShaMatches) {
    return { target: "image", quarantine: true, reason: "sha-mismatch" };
  }
  if (i.requiresCore) return { target: "image", quarantine: false, reason: "requires-core" };
  if (i.coreSupersedes) return { target: "image", quarantine: false, reason: "core-supersedes" };
  if (i.bootAttempts >= MAX_BOOT_ATTEMPTS) {
    return { target: "image", quarantine: true, reason: "crash-loop" };
  }
  return { target: "ota", quarantine: false, reason: "ota" };
}

interface ActivePayload {
  manifestValid: boolean;
  version: string | null;
  minCoreVersion: string | null;
  mainSha256: string | null;
}
function readActivePayload(): ActivePayload {
  try {
    const raw = fs.readFileSync(activeManifest, "utf8");
    const m = JSON.parse(raw) as Record<string, unknown>;
    const version = typeof m["version"] === "string" ? m["version"] : null;
    const minCoreVersion = typeof m["minCoreVersion"] === "string" ? m["minCoreVersion"] : null;
    const mainSha256 = typeof m["mainSha256"] === "string" ? m["mainSha256"] : null;
    const valid = version !== null && minCoreVersion !== null;
    return { manifestValid: valid, version, minCoreVersion, mainSha256 };
  } catch {
    return { manifestValid: false, version: null, minCoreVersion: null, mainSha256: null };
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`${new Date().toISOString()} [INFO] [loader] ${msg}`);
}

async function importMain(moduleUrl: string): Promise<() => Promise<void>> {
  const mod = (await import(moduleUrl)) as { main?: () => Promise<void> };
  if (typeof mod.main !== "function") {
    throw new Error(`module ${moduleUrl} has no exported main()`);
  }
  return mod.main;
}

export async function runLoader(): Promise<void> {
  const state = readState();
  const hasBundle = fs.existsSync(activeMain) && fs.existsSync(activeManifest);
  const payload = hasBundle ? readActivePayload() : { manifestValid: false, version: null, minCoreVersion: null, mainSha256: null };

  let mainShaMatches = false;
  if (hasBundle && payload.mainSha256) {
    try {
      const bytes = fs.readFileSync(activeMain);
      mainShaMatches = createHash("sha256").update(bytes).digest("hex").toLowerCase() === payload.mainSha256.toLowerCase();
    } catch {
      mainShaMatches = false;
    }
  }

  const requiresCore = payload.minCoreVersion ? compareCore(CORE_VERSION, payload.minCoreVersion) < 0 : false;
  // A freshly installed, strictly newer core image supersedes an old OTA payload.
  const coreSupersedes = payload.version ? compareCore(CORE_VERSION, payload.version) > 0 : false;

  const decision = decideBundle({
    hasBundle,
    manifestValid: payload.manifestValid,
    hasMainSha: payload.mainSha256 !== null,
    mainShaMatches,
    requiresCore,
    coreSupersedes,
    bootAttempts: state.bootAttempts,
  });

  log(`decision=${decision.target} reason=${decision.reason} core=${CORE_VERSION} ota=${payload.version ?? "-"} attempts=${state.bootAttempts}`);

  if (decision.quarantine) quarantineActive(payload.version);

  // The payload calls this after a successful start to clear the crash counter.
  (globalThis as { __otaMarkHealthy?: () => void }).__otaMarkHealthy = () => {
    const s = readState();
    s.bootAttempts = 0;
    s.lastGoodAt = new Date().toISOString();
    writeState(s);
  };

  const imageUrl = new URL("../plugin/index.js", import.meta.url).href;

  if (decision.target === "ota" && payload.version) {
    const next = readState();
    next.bootAttempts += 1;
    writeState(next);
    process.env[`${ENV_PREFIX}_OTA_ACTIVE`] = "1";
    process.env[`${ENV_PREFIX}_OTA_VERSION`] = payload.version;
    try {
      log(`running OTA bundle ${payload.version}`);
      const main = await importMain(pathToFileURL(activeMain).href);
      await main();
      return;
    } catch (err) {
      log(`OTA start failed (${err instanceof Error ? err.message : String(err)}); quarantining and falling back to image`);
      quarantineActive(payload.version);
      delete process.env[`${ENV_PREFIX}_OTA_ACTIVE`];
      delete process.env[`${ENV_PREFIX}_OTA_VERSION`];
    }
  }

  log("running image bundle");
  const main = await importMain(imageUrl);
  await main();
}

// Auto-run only when executed as the process entrypoint (so tests can import
// decideBundle without triggering a real boot).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  // Global robustness: never let an unhandled rejection kill the process.
  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error(`${new Date().toISOString()} [ERROR] [loader] unhandledRejection: ${String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    // eslint-disable-next-line no-console
    console.error(`${new Date().toISOString()} [ERROR] [loader] uncaughtException: ${err instanceof Error ? err.message : String(err)}`);
  });

  void runLoader().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`${new Date().toISOString()} [ERROR] [loader] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
