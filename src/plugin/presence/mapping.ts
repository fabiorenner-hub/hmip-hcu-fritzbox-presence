import * as crypto from "crypto";
import { NetDevice } from "../fritzbox/client";
import { MatchBy } from "../config";

/**
 * Presence model: each configured person becomes one OCCUPANCY_SENSOR device.
 * A person is "present" when at least one of their mapped identifiers
 * (device name or MAC, depending on matchBy) is currently active on the
 * FRITZ!Box.
 */

export interface Person {
  /** Display name as configured by the user. */
  name: string;
  /** Stable Connect API deviceId derived from the name. */
  deviceId: string;
  /** Identifiers (device names or MACs) assigned to this person. */
  identifiers: string[];
}

export interface MatchOptions {
  matchBy: MatchBy;
  caseInsensitive: boolean;
}

/**
 * Parse a mapping string of the form
 *   "Person=id1,id2|Person2=id3"
 * into a list of people. Invalid segments are skipped.
 */
export function parseMapping(mapping: string): Person[] {
  const people: Person[] = [];
  if (!mapping) return people;

  for (const segment of mapping.split("|")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const name = trimmed.slice(0, eq).trim();
    const idsPart = trimmed.slice(eq + 1).trim();
    if (!name || !idsPart) continue;

    const identifiers = idsPart
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    if (identifiers.length === 0) continue;

    people.push({ name, deviceId: deviceIdForPerson(name), identifiers });
  }

  return people;
}

/**
 * Deterministic, stable deviceId for a person. Must stay identical across
 * DISCOVER_RESPONSE, STATUS_RESPONSE and STATUS_EVENT (validation checklist #4).
 */
export function deviceIdForPerson(name: string): string {
  const hash = crypto.createHash("sha1").update(name).digest("hex").slice(0, 16);
  return `presence-${hash}`;
}

function normalize(value: string, caseInsensitive: boolean): string {
  return caseInsensitive ? value.toLowerCase() : value;
}

/**
 * Compute the set of present people for a snapshot of active network devices.
 * Returns a map of deviceId -> presenceDetected.
 */
export function computePresence(
  people: Person[],
  activeDevices: NetDevice[],
  options: MatchOptions
): Map<string, boolean> {
  const onlineKeys = new Set(
    activeDevices.map((d) =>
      normalize(options.matchBy === "mac" ? d.mac : d.name, options.caseInsensitive)
    )
  );

  const result = new Map<string, boolean>();
  for (const person of people) {
    const present = person.identifiers.some((id) =>
      onlineKeys.has(normalize(id, options.caseInsensitive))
    );
    result.set(person.deviceId, present);
  }
  return result;
}
