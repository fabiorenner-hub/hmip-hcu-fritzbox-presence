import * as http from "node:http";
import { DASHBOARD_PORT, ENV_PREFIX } from "../pluginMeta";
import { log } from "../logger";
import type { ConfigStore } from "../config";
import type { OtaManager } from "../ota/manager";
import type { Telemetry } from "../analytics/telemetry";
import { DASHBOARD_HTML } from "./page";

export interface DashboardDeps {
  config: ConfigStore;
  ota: OtaManager;
  telemetry: Telemetry;
  getCounts: () => { persons: number; present: number };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(data);
}

async function readBody(req: http.IncomingMessage, limit = 16_384): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Start the local OTA/settings dashboard. Resolves once listening (or after a
 * bind failure, which is logged but non-fatal — the plugin must run regardless).
 */
export function startDashboard(deps: DashboardDeps): Promise<void> {
  const port = Number(process.env[`${ENV_PREFIX}_DASHBOARD_PORT`] ?? DASHBOARD_PORT);

  const server = http.createServer((req, res) => {
    handle(req, res, deps).catch((err) => {
      sendJson(res, 500, { error: { code: "internal", message: err instanceof Error ? err.message : String(err) } });
    });
  });

  return new Promise((resolve) => {
    server.on("error", (err) => {
      log.warn("plugin", `Dashboard listen failed on :${port}: ${err.message}`);
      resolve();
    });
    server.listen(port, "0.0.0.0", () => {
      log.info("plugin", `Dashboard listening on http://0.0.0.0:${port}`);
      resolve();
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: DashboardDeps
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  const method = req.method ?? "GET";

  if (p === "/" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (p === "/api/state" && method === "GET") {
    const s = deps.ota.getStatus();
    sendJson(res, 200, { ok: true, coreVersion: s.coreVersion, otaVersion: s.otaVersion });
    return;
  }

  if (p === "/api/ota/status" && method === "GET") {
    sendJson(res, 200, deps.ota.getStatus());
    return;
  }

  if (p === "/api/ota/check" && method === "POST") {
    sendJson(res, 200, await deps.ota.check());
    return;
  }

  if (p === "/api/ota/install" && method === "POST") {
    // install() may trigger a process exit shortly after resolving.
    sendJson(res, 200, await deps.ota.install());
    return;
  }

  if (p === "/api/analytics/preview" && method === "GET") {
    sendJson(res, 200, await deps.telemetry.buildPayload("heartbeat"));
    return;
  }

  if (p === "/api/config" && method === "GET") {
    sendJson(res, 200, {
      analytics: { enabled: deps.config.getAnalyticsConfig().enabled },
      updates: deps.config.getUpdatesConfig(),
      counts: deps.getCounts(),
    });
    return;
  }

  if (p === "/api/config" && method === "POST") {
    const body = (await readBody(req)) as Record<string, unknown>;
    const props: Record<string, unknown> = {};
    if (typeof body["analyticsEnabled"] === "boolean") props["analyticsEnabled"] = body["analyticsEnabled"];
    if (typeof body["updatesMode"] === "string") props["updatesMode"] = body["updatesMode"];
    if (typeof body["updatesChannel"] === "string") props["updatesChannel"] = body["updatesChannel"];
    deps.config.applyUpdate(props);
    sendJson(res, 200, {
      analytics: { enabled: deps.config.getAnalyticsConfig().enabled },
      updates: deps.config.getUpdatesConfig(),
    });
    return;
  }

  sendJson(res, 404, { error: { code: "not-found", message: p } });
}
