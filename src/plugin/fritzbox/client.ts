import * as crypto from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { log } from "../logger";

/**
 * FRITZ!Box session client.
 *
 * Implements the standard `login_sid.lua` challenge-response flow as documented
 * by AVM (AVM Technical Note "Session-ID"). Supports both the modern PBKDF2
 * challenge (prefix "2$") and the legacy MD5/UTF-16LE challenge as a fallback,
 * which covers Fritz!OS 7.57+ as required by the original project.
 */

const EMPTY_SID = "0000000000000000";

export interface NetDevice {
  mac: string;
  name: string;
  /** state.class, e.g. "globe_online" or "globe_online_guest". */
  stateClass: string;
}

export class FritzBoxAuthError extends Error {}

export class FritzBoxClient {
  private sid: string = EMPTY_SID;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly ignoreCertificates: boolean;
  private readonly timeoutMs: number;

  constructor(opts: {
    baseUrl: string;
    username: string;
    password: string;
    ignoreCertificates: boolean;
    timeoutSeconds?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.username = opts.username;
    this.password = opts.password;
    this.ignoreCertificates = opts.ignoreCertificates;
    this.timeoutMs = Math.max(1, opts.timeoutSeconds ?? 10) * 1000;
  }

  /** Authenticate and store the session id. Throws FritzBoxAuthError on failure. */
  async auth(): Promise<void> {
    const challengeXml = await this.httpGet(`${this.baseUrl}/login_sid.lua`);
    const challenge = extractTag(challengeXml, "Challenge");
    const existingSid = extractTag(challengeXml, "SID");

    if (existingSid && existingSid !== EMPTY_SID) {
      this.sid = existingSid;
      return;
    }
    if (!challenge) {
      throw new FritzBoxAuthError("No challenge returned by FRITZ!Box");
    }

    const response = this.computeChallengeResponse(challenge);
    const query =
      `?username=${encodeURIComponent(this.username)}` +
      `&response=${encodeURIComponent(response)}`;
    const loginXml = await this.httpGet(`${this.baseUrl}/login_sid.lua${query}`);
    const sid = extractTag(loginXml, "SID");

    if (!sid || sid === EMPTY_SID) {
      throw new FritzBoxAuthError("Login failed: invalid username or password");
    }
    this.sid = sid;
    log.info("fritzbox", "Authenticated, session established");
  }

  /**
   * Load all currently active network devices.
   * Re-authenticates once if the session has expired.
   */
  async getNetDevices(): Promise<NetDevice[]> {
    if (this.sid === EMPTY_SID) {
      await this.auth();
    }
    try {
      return await this.fetchNetDevices();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        log.info("fritzbox", "Session expired, refreshing");
        this.sid = EMPTY_SID;
        await this.auth();
        return this.fetchNetDevices();
      }
      throw err;
    }
  }

  private async fetchNetDevices(): Promise<NetDevice[]> {
    const form = new URLSearchParams({
      sid: this.sid,
      page: "netDev",
      xhrId: "cleanup",
      xhr: "1",
    });
    const body = await this.httpPostForm(`${this.baseUrl}/data.lua`, form);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // data.lua returns a login page (HTML) when the session is invalid.
      throw new SessionExpiredError();
    }

    const active = (parsed as NetDevResponse)?.data?.active;
    if (!Array.isArray(active)) {
      // Some firmwares wrap the session-expired hint in valid JSON.
      const sidState = (parsed as { sid?: string }).sid;
      if (sidState === EMPTY_SID) {
        throw new SessionExpiredError();
      }
      return [];
    }

    return active.map((d) => ({
      mac: d.mac ?? "",
      name: d.name ?? "",
      stateClass: d.state?.class ?? "",
    }));
  }

  private computeChallengeResponse(challenge: string): string {
    if (challenge.startsWith("2$")) {
      // PBKDF2 challenge: "2$<iter1>$<salt1>$<iter2>$<salt2>"
      const [, iter1Str, salt1Hex, iter2Str, salt2Hex] = challenge.split("$");
      if (!iter1Str || !salt1Hex || !iter2Str || !salt2Hex) {
        throw new FritzBoxAuthError("Malformed PBKDF2 challenge from FRITZ!Box");
      }
      const iter1 = parseInt(iter1Str, 10);
      const iter2 = parseInt(iter2Str, 10);
      const hash1 = crypto.pbkdf2Sync(
        Buffer.from(this.password, "utf8"),
        Buffer.from(salt1Hex, "hex"),
        iter1,
        32,
        "sha256"
      );
      const hash2 = crypto.pbkdf2Sync(
        hash1,
        Buffer.from(salt2Hex, "hex"),
        iter2,
        32,
        "sha256"
      );
      return `${salt2Hex}$${hash2.toString("hex")}`;
    }

    // Legacy MD5 challenge: md5 over UTF-16LE of "<challenge>-<password>".
    const text = `${challenge}-${this.password}`;
    const md5 = crypto
      .createHash("md5")
      .update(Buffer.from(text, "utf16le"))
      .digest("hex");
    return `${challenge}-${md5}`;
  }

  private httpGet(url: string): Promise<string> {
    return this.request(url, "GET");
  }

  private httpPostForm(url: string, form: URLSearchParams): Promise<string> {
    return this.request(url, "POST", form.toString());
  }

  private request(url: string, method: "GET" | "POST", body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const isHttps = u.protocol === "https:";
      const headers: Record<string, string> = {};
      if (body !== undefined) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers["Content-Length"] = Buffer.byteLength(body).toString();
      }

      const options: https.RequestOptions = {
        method,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        headers,
      };
      if (isHttps && this.ignoreCertificates) {
        (options as https.RequestOptions).rejectUnauthorized = false;
      }

      const transport = isHttps ? https : http;
      const req = transport.request(options, (res: import("http").IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      req.on("error", reject);
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error(`request timed out after ${this.timeoutMs}ms`));
      });
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }
}

class SessionExpiredError extends Error {}

interface NetDevResponse {
  data?: {
    active?: Array<{
      mac?: string;
      name?: string;
      state?: { class?: string };
    }>;
  };
}

/** Extract the inner text of the first <Tag>...</Tag> occurrence. */
function extractTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>(.*?)</${tag}>`, "s").exec(xml);
  return match?.[1]?.trim();
}
