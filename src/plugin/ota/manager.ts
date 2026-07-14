import { ENV_PREFIX } from "../pluginMeta";
import {
  type FetchLike,
  type LatestRelease,
  type ReleaseAsset,
  fetchLatestRelease,
  fetchLatestPrerelease,
  findOtaAssets,
} from "./github";
import { type OtaManifest, parseManifestJson } from "./manifest";
import { isAtLeast, isNewer, isNewerWithBuild } from "./semver";
import { type InstallResult, installBundle } from "./installer";

export type Channel = "stable" | "experimental";
export type UpdateMode = "manual" | "auto";

export interface OtaManagerConfig {
  channel: Channel;
  mode: UpdateMode;
  checkIntervalHours: number;
}

export interface OtaStatus {
  coreVersion: string;
  otaVersion: string;
  otaActive: boolean;
  channel: Channel;
  mode: UpdateMode;
  latestVersion: string | null;
  htmlUrl: string | null;
  updateAvailable: boolean;
  requiresCore: boolean;
  minCoreVersion: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastInstall: InstallResult | null;
}

export interface OtaManagerDeps {
  coreVersion: string;
  dataDir: string;
  getConfig: () => OtaManagerConfig;
  fetchImpl?: FetchLike;
  requestRestart?: () => void;
  publicKeyPem?: string;
  logger?: (lvl: "info" | "warn" | "error", msg: string) => void;
}

export class OtaManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private latest: OtaManifest | null = null;
  private latestRelease: LatestRelease | null = null;
  private lastCheckedAt: string | null = null;
  private lastError: string | null = null;
  private lastInstall: InstallResult | null = null;

  constructor(private readonly deps: OtaManagerDeps) {}

  private get fetch(): FetchLike {
    return (
      this.deps.fetchImpl ??
      ((input, init) =>
        (globalThis as unknown as { fetch: FetchLike }).fetch(input, init))
    );
  }

  private log(lvl: "info" | "warn" | "error", msg: string): void {
    this.deps.logger?.(lvl, msg);
  }

  getChannel(): Channel {
    return this.deps.getConfig().channel;
  }

  /** Version of the running payload: OTA env override, else the image core version. */
  otaVersion(): string {
    return process.env[`${ENV_PREFIX}_OTA_VERSION`] ?? this.deps.coreVersion;
  }

  otaActive(): boolean {
    return process.env[`${ENV_PREFIX}_OTA_ACTIVE`] === "1";
  }

  private async resolveRelease(): Promise<LatestRelease | null> {
    return this.getChannel() === "experimental"
      ? fetchLatestPrerelease(this.fetch)
      : fetchLatestRelease(this.fetch);
  }

  private manifestIsNewer(m: OtaManifest): boolean {
    return this.getChannel() === "experimental"
      ? isNewerWithBuild(m.version, this.otaVersion())
      : isNewer(m.version, this.otaVersion());
  }

  private requiresCore(m: OtaManifest): boolean {
    return !isAtLeast(this.deps.coreVersion, m.minCoreVersion);
  }

  private bundleAssetFor(rel: LatestRelease, m: OtaManifest): ReleaseAsset | null {
    const byName = rel.assets.find((a) => a.name === m.bundleName);
    if (byName) return byName;
    return findOtaAssets(rel).bundle;
  }

  async check(): Promise<OtaStatus> {
    this.lastCheckedAt = new Date().toISOString();
    this.lastError = null;
    try {
      const rel = await this.resolveRelease();
      if (!rel) {
        this.latest = null;
        this.latestRelease = null;
        return this.getStatus();
      }
      const assets = findOtaAssets(rel);
      if (!assets.manifest) {
        this.latest = null;
        this.latestRelease = rel;
        return this.getStatus();
      }
      const r = await this.fetch(assets.manifest.url, {
        headers: { "User-Agent": "hcu-ota" },
      });
      const manifest = r.ok ? parseManifestJson(await r.text()) : null;
      this.latest = manifest;
      this.latestRelease = rel;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log("warn", `OTA check failed: ${this.lastError}`);
    }
    return this.getStatus();
  }

  /** Install the latest known update (if any, not requiring a new core). */
  async install(): Promise<InstallResult> {
    if (!this.latest || !this.latestRelease) {
      return { code: "download-failed", message: "no update resolved; run check() first" };
    }
    if (!this.manifestIsNewer(this.latest)) {
      return { code: "download-failed", message: "already current" };
    }
    if (this.requiresCore(this.latest)) {
      return { code: "download-failed", message: "requires a newer core image" };
    }
    const bundle = this.bundleAssetFor(this.latestRelease, this.latest);
    if (!bundle) return { code: "bad-bundle", message: "no bundle asset in release" };

    this.log("info", `Installing OTA ${this.latest.version} …`);
    const result = await installBundle(
      this.deps.dataDir,
      this.latest,
      bundle,
      this.fetch,
      this.deps.publicKeyPem
    );
    this.lastInstall = result;
    if (result.code === "installed") {
      this.log("info", `OTA ${result.version} installed; requesting restart`);
      this.deps.requestRestart?.();
    } else {
      this.log("warn", `OTA install failed: ${result.code} ${result.message ?? ""}`);
    }
    return result;
  }

  getStatus(): OtaStatus {
    const cfg = this.deps.getConfig();
    const updateAvailable = this.latest ? this.manifestIsNewer(this.latest) : false;
    return {
      coreVersion: this.deps.coreVersion,
      otaVersion: this.otaVersion(),
      otaActive: this.otaActive(),
      channel: cfg.channel,
      mode: cfg.mode,
      latestVersion: this.latest?.version ?? null,
      htmlUrl: this.latestRelease?.htmlUrl ?? null,
      updateAvailable,
      requiresCore: this.latest ? this.requiresCore(this.latest) : false,
      minCoreVersion: this.latest?.minCoreVersion ?? null,
      lastCheckedAt: this.lastCheckedAt,
      lastError: this.lastError,
      lastInstall: this.lastInstall,
    };
  }

  /** Start periodic checks. In auto mode, applicable updates install themselves. */
  start(): void {
    if (this.timer) return;
    const run = async (): Promise<void> => {
      const status = await this.check();
      if (
        this.deps.getConfig().mode === "auto" &&
        status.updateAvailable &&
        !status.requiresCore
      ) {
        await this.install();
      }
    };
    const hours = Math.max(1, this.deps.getConfig().checkIntervalHours);
    // Best-effort first check shortly after boot, then on the interval.
    setTimeout(() => void run().catch(() => undefined), 90_000);
    this.timer = setInterval(() => void run().catch(() => undefined), hours * 3_600_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
