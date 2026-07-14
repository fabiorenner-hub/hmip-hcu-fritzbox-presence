import { describe, it, expect } from "vitest";
import { parseMapping, computePresence, deviceIdForPerson } from "../src/plugin/presence/mapping";
import type { NetDevice } from "../src/plugin/fritzbox/client";

const dev = (name: string, mac: string): NetDevice => ({ name, mac, stateClass: "globe_online" });

describe("presence mapping", () => {
  it("parses people and yields stable deviceIds", () => {
    const people = parseMapping("Frank=iPhone-Frank,Laptop|Anna=Pixel");
    expect(people).toHaveLength(2);
    expect(people[0]!.deviceId).toBe(deviceIdForPerson("Frank"));
    expect(people[0]!.deviceId).not.toBe(people[1]!.deviceId);
    expect(parseMapping("bad|=x|Y=")).toHaveLength(0);
  });

  it("matches by name", () => {
    const people = parseMapping("Frank=iPhone-Frank|Anna=Pixel");
    const p = computePresence(people, [dev("iPhone-Frank", "AA:BB")], { matchBy: "name", caseInsensitive: false });
    expect(p.get(people[0]!.deviceId)).toBe(true);
    expect(p.get(people[1]!.deviceId)).toBe(false);
  });

  it("matches by mac, case-insensitive", () => {
    const people = parseMapping("Frank=aa:bb:cc");
    const active = [dev("iPhone", "AA:BB:CC")];
    expect(computePresence(people, active, { matchBy: "mac", caseInsensitive: true }).get(people[0]!.deviceId)).toBe(true);
    expect(computePresence(people, active, { matchBy: "mac", caseInsensitive: false }).get(people[0]!.deviceId)).toBe(false);
  });
});
