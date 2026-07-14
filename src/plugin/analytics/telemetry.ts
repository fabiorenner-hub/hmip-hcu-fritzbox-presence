import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  PLUGIN_ID,
  ENV_PREFIX,
  TELEMETRY_ENDPOINT,
  TELEMETRY_SALT,
} from "../pluginMeta";

/**
 * Data-frugal telemetry client for the central "HCU Plugin Analytics" system.
 *
 * Privacy: only pseudonymous technical metadata is sent (schema, event,
 * installId, plugin/core/OTA versions, arch, firmware, language). NEVER any
 * SGTIN/serial in clear text, IP, names, rooms, devices, measurements,
 * automations, schedules, config, credentials or tokens. Fire-and-forget with
 * short timeouts; failures are silent (at most a local log line) and never
 * block the plugin.
 */

export type TelemetryEvent = "start" | "heartbeat" | "update";

export interface TelemetryPayload {
  schema: 1;
  event: TelemetryEvent;
  installId: string;
  pluginId: string;
  coreVersion: string;
  otaVersion: string;
  buildId?: string;
  arch?: string;
  hcuFirmware?: string;
  lang?: string;
  ts?: string;
}

export interface TelemetryVersions {
  coreVersion: string;
  otaVersion: string;
  buildId?: string;
  arch?: string;
  hcuFirmware?: string;
  lang?: string;
}

interface TelemetryState {
  lastTelemetrySuccess?: string;
  lastTelemetryAttempt?: string;
  lastTelemetryEvent?: string;
  lastVersion?: string;
  lastHeartbeatAt?: string;
  installSeed?: string;
}

export interface TelemetryDeps {
  dataDir: string;
  getEnabled: () => boolean;
  getVersions: () => TelemetryVersions;
  /** Path to the SGTIN file mounted by the HCU. Default `/SGTIN`. */
  sgtinPath?: string;
  /** Optional shared secret (spam hurdle only) sent as X-HPA-Ping-Secret. */
  secret?: string;
  fetchImpl?: typeof fetch;
  logger?: (lvl: "info" | "warn", msg: string) => void;
}

const MAX_BYTES = 4096;
const CONNECT_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 24 * 3_600_000;
const RETRY_MS = 15 * 60_000;

export class Telemetry {
  private installId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: TelemetryDeps) {}

  private get statePath(): string {
    return path.join(this.deps.dataDir, "telemetry-state.json");
  }

  private get fetchImpl(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }

  private log(lvl: "info" | "warn", msg: string): void {
    this.deps.logger?.(lvl, msg);
  }

  private async readState(): Promise<TelemetryState> {
    try {
      return JSON.parse(await fs.readFile(this.statePath, "utf8")) as TelemetryState;
    } catch {
      return {};
    }
  }

  private async writeState(next: TelemetryState): Promise<void> {
    try {
      await fs.mkdir(this.deps.dataDir, { recursive: true });
      const tmp = `${this.statePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(next), "utf8");
      await fs.rename(tmp, this.statePath);
    } catch {
      /* best-effort */
    }
  }

  /**
   * Stable, pseudonymous install id: 64 lowercase hex from
   * sha256(salt + hcuSgtin). Falls back to a persisted random seed when the
   * SGTIN file is unavailable (still stable per install, correct format).
   */
  async getInstallId(): Promise<string> {
    if (this.installId) return this.installId;
    let secretSource: string;
    try {
      const sgtin = (await fs.readFile(this.deps.sgtinPath ?? "/SGTIN", "utf8")).trim();
      if (sgtin.length === 0) throw new Error("empty SGTIN");
      secretSource = sgtin;
    } catch {
      const state = await this.readState();
      let seed = state.installSeed;
      if (!seed || seed.length < 16) {
        seed = createHash("sha256")
          .update(`${Date.now()}:${Math.random()}:${process.pid}`)
          .digest("hex");
        await this.writeState({ ...state, installSeed: seed });
      }
      secretSource = `seed:${seed}`;
    }
    this.installId = createHash("sha256")
      .update(`${TELEMETRY_SALT}${secretSource}`)
      .digest("hex")
      .toLowerCase();
    return this.installId;
  }

  /** Build the payload for an event, honouring the 4096-byte size limit. */
  async buildPayload(event: TelemetryEvent): Promise<TelemetryPayload> {
    const v = this.deps.getVersions();
    const base: TelemetryPayload = {
      schema: 1,
      event,
      installId: await this.getInstallId(),
      pluginId: PLUGIN_ID,
      coreVersion: v.coreVersion,
      otaVersion: v.otaVersion,
    };
    // Optional fields added only when present (exactOptionalPropertyTypes).
    const optional: Array<[keyof TelemetryPayload, string | undefined]> = [
      ["buildId", v.buildId],
      ["arch", v.arch],
      ["hcuFirmware", v.hcuFirmware],
      ["lang", v.lang],
      ["ts", new Date().toISOString()],
    ];
    const payload: TelemetryPayload = { ...base };
    for (const [key, val] of optional) {
      if (val === undefined) continue;
      const candidate = { ...payload, [key]: val };
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= MAX_BYTES) {
        Object.assign(payload, { [key]: val });
      }
    }
    return payload;
  }

  private async post(event: TelemetryEvent): Promise<boolean> {
    const payload = await this.buildPayload(event);
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) return false;

    const controller = new AbortController();
    const connectGuard = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    const totalGuard = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.deps.secret) headers["X-HPA-Ping-Secret"] = this.deps.secret;

    const endpoint = process.env[`${ENV_PREFIX}_TELEMETRY_ENDPOINT`] ?? TELEMETRY_ENDPOINT;
    try {
      const res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      // 204 (also for rate-limited duplicates) counts as success.
      return res.status === 204 || res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(connectGuard);
      clearTimeout(totalGuard);
    }
  }

  /** Send an event (fire-and-forget). Records local status; single delayed retry. */
  async send(event: TelemetryEvent): Promise<void> {
    if (!this.deps.getEnabled()) return;
    const state = await this.readState();
    state.lastTelemetryAttempt = new Date().toISOString();
    state.lastTelemetryEvent = event;
    await this.writeState(state);

    const ok = await this.post(event);
    if (ok) {
      const s = await this.readState();
      s.lastTelemetrySuccess = new Date().toISOString();
      if (event === "heartbeat") s.lastHeartbeatAt = s.lastTelemetrySuccess;
      await this.writeState(s);
      this.log("info", `telemetry ${event} ok`);
      return;
    }
    this.log("warn", `telemetry ${event} failed; will retry later`);
    // Single delayed retry; further attempts only via the heartbeat interval.
    if (!this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.post(event).then(async (retryOk) => {
          if (retryOk) {
            const s = await this.readState();
            s.lastTelemetrySuccess = new Date().toISOString();
            await this.writeState(s);
          }
        });
      }, RETRY_MS);
      this.retryTimer.unref?.();
    }
  }

  /**
   * Decide the boot event: 'update' when the running version changed since the
   * last boot, otherwise 'start'. Then arm the periodic heartbeat.
   */
  async start(): Promise<void> {
    const v = this.deps.getVersions();
    const current = v.buildId ?? v.otaVersion;
    const state = await this.readState();
    const bootEvent: TelemetryEvent =
      state.lastVersion && state.lastVersion !== current ? "update" : "start";
    await this.writeState({ ...state, lastVersion: current });

    this.bootTimer = setTimeout(() => {
      void this.send(bootEvent).catch(() => undefined);
    }, 5_000);
    this.bootTimer.unref?.();

    this.heartbeatTimer = setInterval(() => {
      void this.send("heartbeat").catch(() => undefined);
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.heartbeatTimer = null;
    this.bootTimer = null;
    this.retryTimer = null;
  }
}
