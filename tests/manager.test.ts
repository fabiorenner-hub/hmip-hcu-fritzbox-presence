import { describe, it, expect } from "vitest";
import { OtaManager, type OtaManagerConfig } from "../src/plugin/ota/manager";
import { LATEST_RELEASE_API, RELEASES_API, type FetchLike } from "../src/plugin/ota/github";

const SHA = "a".repeat(64);

function releaseJson(prerelease: boolean, bundleName: string) {
  return {
    tag_name: prerelease ? "experimental" : "v9.9.9",
    html_url: "https://github.com/x/y/releases",
    prerelease,
    assets: [
      { name: "ota-manifest.json", browser_download_url: "https://x/ota-manifest.json" },
      { name: bundleName, browser_download_url: `https://x/${bundleName}` },
    ],
  };
}

function manifestJson(minCore: string, version = "9.9.9") {
  return JSON.stringify({
    version,
    minCoreVersion: minCore,
    sha256: SHA,
    assetUrl: "https://x/bundle.json",
    bundleName: "fritzboxpresence-ota-9.9.9.json",
  });
}

function mockFetch(minCore: string, prerelease = false): FetchLike {
  return async (url: string) => {
    const ok = (json: unknown, text?: string) => ({
      ok: true,
      status: 200,
      json: async () => json,
      text: async () => text ?? JSON.stringify(json),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    if (url === LATEST_RELEASE_API) return ok(releaseJson(false, "fritzboxpresence-ota-9.9.9.json"));
    if (url === RELEASES_API) return ok([releaseJson(true, "fritzboxpresence-ota-exp.json")]);
    if (url.endsWith("ota-manifest.json")) return ok({}, manifestJson(minCore));
    return { ok: false, status: 404, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

function mgr(cfg: OtaManagerConfig, fetchImpl: FetchLike, coreVersion = "1.0.0") {
  return new OtaManager({ coreVersion, dataDir: "/tmp/does-not-matter", getConfig: () => cfg, fetchImpl });
}

describe("OtaManager", () => {
  it("detects a stable update", async () => {
    const m = mgr({ channel: "stable", mode: "manual", checkIntervalHours: 6 }, mockFetch("0.0.1"));
    const s = await m.check();
    expect(s.latestVersion).toBe("9.9.9");
    expect(s.updateAvailable).toBe(true);
    expect(s.requiresCore).toBe(false);
  });

  it("flags requiresCore when the image is too old", async () => {
    const m = mgr({ channel: "stable", mode: "manual", checkIntervalHours: 6 }, mockFetch("99.0.0"));
    const s = await m.check();
    expect(s.updateAvailable).toBe(true);
    expect(s.requiresCore).toBe(true);
  });

  it("uses the prerelease on the experimental channel", async () => {
    const m = mgr({ channel: "experimental", mode: "manual", checkIntervalHours: 6 }, mockFetch("0.0.1", true));
    const s = await m.check();
    expect(s.channel).toBe("experimental");
    expect(s.latestVersion).toBe("9.9.9");
  });

  it("reports no update when already current", async () => {
    const m = mgr({ channel: "stable", mode: "manual", checkIntervalHours: 6 }, mockFetch("0.0.1"), "9.9.9");
    const s = await m.check();
    expect(s.updateAvailable).toBe(false);
  });
});
