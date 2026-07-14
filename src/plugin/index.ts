import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { PLUGIN_ID, ENV_PREFIX } from "./pluginMeta";
import { APP_VERSION } from "../shared/version";
import { log } from "./logger";
import { ConfigStore } from "./config";
import { FritzBoxPresencePlugin } from "./connect/plugin";
import { OtaManager } from "./ota/manager";
import { Telemetry, type TelemetryVersions } from "./analytics/telemetry";
import { startDashboard } from "./dashboard/server";

function env(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}_${name}`];
}

/** Token order: env var -> TOKEN_PATH file -> /TOKEN (mounted by the HCU). */
function readAuthToken(): string {
  const inline = env("AUTH_TOKEN");
  if (inline && inline.trim().length > 0) return inline.trim();
  const candidates = [env("TOKEN_PATH"), "/TOKEN"].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  for (const p of candidates) {
    try {
      const v = fs.readFileSync(p, "utf8").trim();
      if (v.length > 0) return v;
    } catch {
      /* try next */
    }
  }
  return "";
}

function otaLog(lvl: "info" | "warn" | "error", msg: string): void {
  if (lvl === "error") log.error("plugin", msg);
  else if (lvl === "warn") log.warn("plugin", msg);
  else log.info("plugin", msg);
}

/**
 * Plugin entry. Called by the bootstrap loader (image or OTA payload) and, for
 * convenience, directly when this module is executed as the process entrypoint.
 */
export async function main(): Promise<void> {
  installGlobalHandlers();

  const dataDir = env("DATA_DIR") ?? "/data";
  const coreVersion = env("VERSION") ?? APP_VERSION;
  const host = env("HCU_HOST") ?? "host.containers.internal";
  const configPath = env("CONFIG_PATH") ?? process.env["CONFIG_PATH"] ?? path.join(dataDir, "config.json");
  const authToken = readAuthToken();

  log.info("plugin", `Starting FRITZ!Box presence plugin ${PLUGIN_ID} (core ${coreVersion})`);
  if (authToken.length === 0) {
    log.warn("plugin", "No auth token found (env/TOKEN_PATH//TOKEN); Connect handshake will fail until provided");
  }

  const config = new ConfigStore(configPath);

  const plugin = new FritzBoxPresencePlugin({ pluginId: PLUGIN_ID, host, authToken, config });
  plugin.start();

  // OTA updater. Auto mode installs automatically; manual mode installs from
  // the dashboard's "Update now" button.
  const ota = new OtaManager({
    coreVersion,
    dataDir,
    getConfig: () => config.getUpdatesConfig(),
    requestRestart: () => {
      log.info("plugin", "Restarting to activate OTA payload …");
      setTimeout(() => process.exit(0), 500);
    },
    logger: otaLog,
  });
  ota.start();

  // Anonymous technical telemetry (opt-out; on by default). Fire-and-forget.
  const telemetry = new Telemetry({
    dataDir,
    getEnabled: () => config.getAnalyticsConfig().enabled,
    getVersions: () => {
      const v: TelemetryVersions = {
        coreVersion,
        otaVersion: ota.otaVersion(),
        arch: process.arch,
        lang: "de",
      };
      const buildId = env("BUILD");
      if (buildId) v.buildId = buildId;
      const firmware = env("HCU_FIRMWARE");
      if (firmware) v.hcuFirmware = firmware;
      return v;
    },
    ...(env("TELEMETRY_SECRET") ? { secret: env("TELEMETRY_SECRET") as string } : {}),
    logger: (lvl, msg) => (lvl === "warn" ? log.warn("plugin", msg) : log.info("plugin", msg)),
  });
  void telemetry.start().catch(() => undefined);

  // Local OTA/settings dashboard (non-fatal: a bind error must not kill the plugin).
  try {
    await startDashboard({ config, ota, telemetry, getCounts: () => plugin.getPresenceCounts() });
  } catch (err) {
    log.warn("plugin", `Dashboard failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Tell the loader the boot succeeded so it clears the crash-loop counter.
  (globalThis as { __otaMarkHealthy?: () => void }).__otaMarkHealthy?.();
}

let handlersInstalled = false;
function installGlobalHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on("unhandledRejection", (reason) => {
    log.error("plugin", `unhandledRejection: ${String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    log.error("plugin", "uncaughtException", err);
  });
}

// Auto-run only when executed directly (not when imported by the loader).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main().catch((err) => {
    log.error("plugin", "fatal", err);
    process.exit(1);
  });
}
