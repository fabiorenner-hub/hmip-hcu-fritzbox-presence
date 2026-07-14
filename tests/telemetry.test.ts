import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Telemetry, type TelemetryVersions } from "../src/plugin/analytics/telemetry";

let dir = "";
const versions: TelemetryVersions = { coreVersion: "0.2.0", otaVersion: "0.2.0", arch: "arm64", lang: "de" };

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "tele-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function make(opts: { enabled: boolean; fetchImpl?: typeof fetch; sgtin?: string }) {
  const sgtinPath = path.join(dir, "SGTIN");
  return {
    tele: new Telemetry({
      dataDir: dir,
      getEnabled: () => opts.enabled,
      getVersions: () => versions,
      sgtinPath,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    }),
    sgtinPath,
  };
}

const ALLOWED = new Set([
  "schema", "event", "installId", "pluginId", "coreVersion", "otaVersion",
  "buildId", "arch", "hcuFirmware", "lang", "ts",
]);

describe("telemetry", () => {
  it("does not send when disabled", async () => {
    let called = 0;
    const { tele } = make({ enabled: false, fetchImpl: (async () => { called += 1; return { status: 204, ok: true }; }) as unknown as typeof fetch });
    await tele.send("start");
    expect(called).toBe(0);
  });

  it("produces a 64-char lowercase hex installId, stable across calls", async () => {
    const { tele, sgtinPath } = make({ enabled: true });
    await fs.writeFile(sgtinPath, "3014F711A0001234\n", "utf8");
    const id1 = await tele.getInstallId();
    const id2 = await tele.getInstallId();
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
    expect(id1).toBe(id2);
    // a different Telemetry instance over the same SGTIN yields the same id
    const { tele: t2 } = make({ enabled: true });
    await fs.writeFile(path.join(dir, "SGTIN"), "3014F711A0001234\n", "utf8");
    expect(await t2.getInstallId()).toBe(id1);
  });

  it("payload has only allowed keys, required fields, and is <= 4096 bytes", async () => {
    const { tele, sgtinPath } = make({ enabled: true });
    await fs.writeFile(sgtinPath, "SGTIN-XYZ", "utf8");
    const p = await tele.buildPayload("heartbeat");
    for (const k of Object.keys(p)) expect(ALLOWED.has(k)).toBe(true);
    expect(p.schema).toBe(1);
    expect(p.event).toBe("heartbeat");
    expect(p.installId).toMatch(/^[0-9a-f]{64}$/);
    expect(p.pluginId).toBe("de.fr.renner.plugin.fritzboxpresence");
    expect(Buffer.byteLength(JSON.stringify(p), "utf8")).toBeLessThanOrEqual(4096);
  });

  it("drops optional fields that violate the ingest constraints", async () => {
    const sgtinPath = path.join(dir, "SGTIN");
    await fs.writeFile(sgtinPath, "SGTIN-XYZ", "utf8");
    const tele = new Telemetry({
      dataDir: dir,
      getEnabled: () => true,
      getVersions: () => ({
        coreVersion: "1.2.3",
        otaVersion: "1.2.3",
        arch: "arm64!!",              // invalid char -> dropped
        lang: "this-lang-is-way-too-long", // > 12 chars -> dropped
        hcuFirmware: "1.4.7",         // valid -> kept
      }),
      sgtinPath,
    });
    const p = await tele.buildPayload("start");
    expect(p.arch).toBeUndefined();
    expect(p.lang).toBeUndefined();
    expect(p.hcuFirmware).toBe("1.4.7");
  });

  it("records success on HTTP 204 when enabled", async () => {
    const { tele, sgtinPath } = make({
      enabled: true,
      fetchImpl: (async () => ({ status: 204, ok: true })) as unknown as typeof fetch,
    });
    await fs.writeFile(sgtinPath, "SGTIN-XYZ", "utf8");
    await tele.send("start");
    const state = JSON.parse(await fs.readFile(path.join(dir, "telemetry-state.json"), "utf8"));
    expect(typeof state.lastTelemetrySuccess).toBe("string");
    expect(state.lastTelemetryEvent).toBe("start");
  });
});
