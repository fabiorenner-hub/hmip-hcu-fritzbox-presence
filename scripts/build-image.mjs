// Build the arm64 container image and export it as a gzipped tarball for
// HCUweb upload. Usage: node scripts/build-image.mjs
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const version = pkg.version;
const tag = `fritzbox-presence:${version}`;
const d = new Date();
const p = (n, l = 2) => String(n).padStart(l, "0");
const buildId = `${version}+${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
const tar = `hmip-hcu-fritzbox-presence-${version}-arm64.tar`;
const gz = `${tar}.gz`;

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status ?? r.signal}`);
}

// 1) Build arm64 image and load it into the local docker image store.
run("docker", [
  "buildx",
  "build",
  "--platform=linux/arm64",
  "--build-arg",
  `FRITZBOXPRESENCE_VERSION=${version}`,
  "--build-arg",
  `FRITZBOXPRESENCE_BUILD=${buildId}`,
  "-t",
  tag,
  "--load",
  ".",
]);

// 2) Save + gzip (docker save writes an OCI/legacy tar; the HCU accepts it).
run("docker", ["save", "-o", tar, tag]);
await pipeline(createReadStream(tar), createGzip({ level: 9 }), createWriteStream(gz));
await fs.rm(tar, { force: true });

const { size } = await fs.stat(gz);
console.log(`\nImage artifact: ${gz} (${(size / 1024 / 1024).toFixed(1)} MB)`);
