import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { OtaManifest } from "./manifest";
import type { FetchLike, ReleaseAsset } from "./github";
import { sha256Hex, sha256Matches, verifySignature } from "./verify";
import { activeDir, stagingDir, otaDir, readState, writeState } from "./state";

/** Bundle format string; bump when the on-disk payload layout changes. */
export const BUNDLE_FORMAT = "fritzboxpresence-ota-1";

export type InstallResultCode =
  | "installed"
  | "download-failed"
  | "verify-failed"
  | "bad-bundle"
  | "write-failed";

export interface InstallResult {
  code: InstallResultCode;
  version?: string;
  message?: string;
}

interface BundleFile {
  format: string;
  version: string;
  files: Record<string, string>; // relative path -> base64
}

/** Only `main.js` and files under `public/` are permitted. No traversal. */
export function isSafeBundlePath(rel: string): boolean {
  if (rel.includes("\0")) return false;
  const norm = rel.replace(/\\/gu, "/");
  if (norm.startsWith("/") || norm.includes("..")) return false;
  if (norm === "main.js") return true;
  return norm.startsWith("public/") && norm.length > "public/".length;
}

export function parseBundleFile(json: string): BundleFile | null {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o["format"] !== "string" || typeof o["version"] !== "string") return null;
  if (o["files"] === null || typeof o["files"] !== "object") return null;
  const filesIn = o["files"] as Record<string, unknown>;
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(filesIn)) {
    if (typeof v !== "string") return null;
    if (!isSafeBundlePath(k)) return null;
    files[k] = v;
  }
  if (!("main.js" in files)) return null;
  return { format: o["format"], version: o["version"], files };
}

async function downloadBytes(
  fetchImpl: FetchLike,
  url: string
): Promise<Uint8Array | null> {
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": "hcu-ota" } });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Download + verify + stage + atomically activate an OTA bundle.
 * On any failure the existing `active/` payload is left untouched.
 */
export async function installBundle(
  dataDir: string,
  manifest: OtaManifest,
  bundleAsset: ReleaseAsset,
  fetchImpl: FetchLike,
  publicKeyPem?: string
): Promise<InstallResult> {
  const bytes = await downloadBytes(fetchImpl, bundleAsset.url);
  if (!bytes) return { code: "download-failed" };

  // 1) sha256 of the downloaded bundle file MUST match the manifest.
  if (!sha256Matches(bytes, manifest.sha256)) {
    return { code: "verify-failed", message: "sha256 mismatch" };
  }
  // 2) Optional Ed25519 signature over the bundle bytes.
  if (!verifySignature(bytes, manifest.signature, publicKeyPem)) {
    return { code: "verify-failed", message: "signature invalid" };
  }

  // 3) Parse + guard the bundle.
  const bundle = parseBundleFile(Buffer.from(bytes).toString("utf8"));
  if (!bundle || bundle.format !== BUNDLE_FORMAT) {
    return { code: "bad-bundle", message: "unexpected format" };
  }

  const staging = stagingDir(dataDir);
  try {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });

    let mainSha256 = "";
    for (const [rel, b64] of Object.entries(bundle.files)) {
      const data = Buffer.from(b64, "base64");
      const dest = path.join(staging, rel);
      if (!dest.startsWith(staging)) return { code: "bad-bundle", message: "path escape" };
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, data);
      if (rel === "main.js") mainSha256 = sha256Hex(new Uint8Array(data));
    }

    // The loader verifies active/main.js against this mainSha256.
    const stagedManifest = { ...manifest, mainSha256 };
    await fs.writeFile(
      path.join(staging, "manifest.json"),
      JSON.stringify(stagedManifest, null, 2),
      "utf8"
    );
  } catch (err) {
    return { code: "write-failed", message: err instanceof Error ? err.message : String(err) };
  }

  // 4) Atomically swap staging -> active.
  try {
    await fs.mkdir(otaDir(dataDir), { recursive: true });
    const active = activeDir(dataDir);
    const backup = `${active}.old`;
    await fs.rm(backup, { recursive: true, force: true });
    await fs.rename(active, backup).catch(() => undefined); // may not exist yet
    await fs.rename(staging, active);
    await fs.rm(backup, { recursive: true, force: true });
  } catch (err) {
    return { code: "write-failed", message: err instanceof Error ? err.message : String(err) };
  }

  // 5) Record the new active version; reset boot counter.
  const state = await readState(dataDir);
  state.activeVersion = manifest.version;
  state.bootAttempts = 0;
  await writeState(dataDir, state);

  return { code: "installed", version: manifest.version };
}
