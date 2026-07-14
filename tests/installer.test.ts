import { describe, it, expect } from "vitest";
import { isSafeBundlePath, parseBundleFile, BUNDLE_FORMAT } from "../src/plugin/ota/installer";

describe("installer path guard", () => {
  it("allows only main.js and public/*", () => {
    expect(isSafeBundlePath("main.js")).toBe(true);
    expect(isSafeBundlePath("public/app.js")).toBe(true);
    expect(isSafeBundlePath("public/")).toBe(false);
    expect(isSafeBundlePath("../evil.js")).toBe(false);
    expect(isSafeBundlePath("/etc/passwd")).toBe(false);
    expect(isSafeBundlePath("public/../../x")).toBe(false);
    expect(isSafeBundlePath("other.js")).toBe(false);
  });

  it("parses a valid bundle and rejects traversal / missing main", () => {
    const good = JSON.stringify({ format: BUNDLE_FORMAT, version: "1.0.0", files: { "main.js": "eA==" } });
    expect(parseBundleFile(good)?.version).toBe("1.0.0");

    expect(parseBundleFile(JSON.stringify({ format: BUNDLE_FORMAT, version: "1", files: { "../x": "eA==" } }))).toBeNull();
    // no main.js -> rejected
    expect(parseBundleFile(JSON.stringify({ format: BUNDLE_FORMAT, version: "1", files: { "public/a": "eA==" } }))).toBeNull();
    expect(parseBundleFile(JSON.stringify({ format: BUNDLE_FORMAT, version: "1", files: {} }))).toBeNull();
    expect(parseBundleFile("not json")).toBeNull();
  });
});
