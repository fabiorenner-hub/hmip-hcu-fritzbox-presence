// Build OTA release assets: the self-contained payload bundle + manifest.
//
// Usage: node scripts/build-ota.mjs [stable|experimental]
//
// Stable      : version = X.Y.Z, tag v<X.Y.Z>, assets named with the version.
// Experimental: version = X.Y.Z+exp.<utc-stamp>, rolling tag "experimental",
//               fixed asset names (*-exp.json). Experimental NEVER bumps the
//               semver core — only the +exp build tail.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const channel = process.argv[2] === "experimental" ? "experimental" : "stable";
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const baseVersion = pkg.version;
const repo = (pkg.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "")
  .replace(/^https:\/\/github\.com\//, "");

const FORMAT = "fritzboxpresence-ota-1";
const OUT_DIR = path.join("release", channel);

function utcStamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

const version = channel === "experimental" ? `${baseVersion}+exp.${utcStamp()}` : baseVersion;
const bundleName =
  channel === "experimental" ? "fritzboxpresence-ota-exp.json" : `fritzboxpresence-ota-${version}.json`;
const manifestName = channel === "experimental" ? "ota-manifest-exp.json" : "ota-manifest.json";
const tag = channel === "experimental" ? "experimental" : `v${version}`;
const assetUrl = `https://github.com/${repo}/releases/download/${tag}/${bundleName}`;

// Bundle the app entry (same as the image bundle) into a single self-contained
// main.js. The loader loads exactly this file as the OTA payload.
const result = await build({
  entryPoints: ["src/plugin/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false,
  banner: { js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);" },
});
const mainJs = result.outputFiles[0].text;

const bundle = {
  format: FORMAT,
  version,
  files: { "main.js": Buffer.from(mainJs, "utf8").toString("base64") },
};
const bundleJson = JSON.stringify(bundle);
const sha256 = createHash("sha256").update(Buffer.from(bundleJson, "utf8")).digest("hex");

const manifest = {
  version,
  minCoreVersion: baseVersion,
  sha256,
  assetUrl,
  bundleName,
};

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, bundleName), bundleJson, "utf8");
await fs.writeFile(path.join(OUT_DIR, manifestName), JSON.stringify(manifest, null, 2), "utf8");
await fs.writeFile(path.join(OUT_DIR, `${bundleName}.sha256`), `${sha256}  ${bundleName}\n`, "utf8");

console.log(`OTA ${channel} assets written to ${OUT_DIR}/`);
console.log(`  version:    ${version}`);
console.log(`  bundle:     ${bundleName} (${bundleJson.length} bytes)`);
console.log(`  sha256:     ${sha256}`);
console.log(`  tag:        ${tag}`);
