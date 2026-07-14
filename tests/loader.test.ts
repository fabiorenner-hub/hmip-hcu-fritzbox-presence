import { describe, it, expect } from "vitest";
import { decideBundle, type DecideInputs } from "../src/bootstrap/loader";

const base: DecideInputs = {
  hasBundle: true,
  manifestValid: true,
  hasMainSha: true,
  mainShaMatches: true,
  requiresCore: false,
  coreSupersedes: false,
  bootAttempts: 0,
};

describe("loader.decideBundle", () => {
  it("runs OTA on the happy path", () => {
    expect(decideBundle(base)).toMatchObject({ target: "ota", quarantine: false });
  });

  it("uses the image when there is no bundle (no quarantine)", () => {
    expect(decideBundle({ ...base, hasBundle: false })).toMatchObject({ target: "image", quarantine: false, reason: "no-bundle" });
  });

  it("quarantines on invalid manifest and on sha mismatch", () => {
    expect(decideBundle({ ...base, manifestValid: false })).toMatchObject({ target: "image", quarantine: true, reason: "manifest-invalid" });
    expect(decideBundle({ ...base, mainShaMatches: false })).toMatchObject({ target: "image", quarantine: true, reason: "sha-mismatch" });
  });

  it("does not quarantine when a newer core is required or supersedes", () => {
    expect(decideBundle({ ...base, requiresCore: true })).toMatchObject({ target: "image", quarantine: false, reason: "requires-core" });
    expect(decideBundle({ ...base, coreSupersedes: true })).toMatchObject({ target: "image", quarantine: false, reason: "core-supersedes" });
  });

  it("quarantines after a crash loop", () => {
    expect(decideBundle({ ...base, bootAttempts: 3 })).toMatchObject({ target: "image", quarantine: true, reason: "crash-loop" });
  });

  it("ignores a missing mainSha (old payload) rather than flagging a mismatch", () => {
    expect(decideBundle({ ...base, hasMainSha: false, mainShaMatches: false })).toMatchObject({ target: "ota" });
  });
});
