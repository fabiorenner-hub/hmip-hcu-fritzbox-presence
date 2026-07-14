import { describe, it, expect } from "vitest";
import { compareSemver, isNewer, isAtLeast, isNewerWithBuild, buildTail } from "../src/plugin/ota/semver";

describe("semver", () => {
  it("compares core versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("v1.2.4", "1.2.3")).toBe(1);
    expect(compareSemver("1.2.3", "1.3.0")).toBe(-1);
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
    expect(isAtLeast("1.4.7", "1.4.7")).toBe(true);
    expect(isAtLeast("1.4.6", "1.4.7")).toBe(false);
  });

  it("orders experimental builds by build tail when core is equal", () => {
    expect(buildTail("1.0.0+exp.20260101-000000")).toBe("exp.20260101-000000");
    expect(isNewerWithBuild("1.0.0+exp.20260102-000000", "1.0.0+exp.20260101-000000")).toBe(true);
    expect(isNewerWithBuild("1.0.0+exp.20260101-000000", "1.0.0+exp.20260101-000000")).toBe(false);
    // a tagged build beats a build with no tail on the same core
    expect(isNewerWithBuild("1.0.0+exp.1", "1.0.0")).toBe(true);
    // a newer core always wins regardless of tail
    expect(isNewerWithBuild("1.0.1", "1.0.0+exp.9")).toBe(true);
  });
});
