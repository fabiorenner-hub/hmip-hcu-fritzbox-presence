// src/plugin/pluginMeta.ts — the single place holding project-specific values.
// Everything else references these constants instead of hardcoding.

/** Reverse-domain plugin identifier (must match the Docker metadata LABEL). */
export const PLUGIN_ID = "de.fr.renner.plugin.fritzboxpresence";

/** GitHub owner/repo used for OTA release lookups. */
export const GITHUB_REPO = "fabiorenner-hub/hmip-hcu-fritzbox-presence";

/** Uppercase env-var prefix, e.g. FRITZBOXPRESENCE_DATA_DIR. */
export const ENV_PREFIX = "FRITZBOXPRESENCE";

/** Unique dashboard/HTTP port per plugin (Port-Registry in the steering spec). */
export const DASHBOARD_PORT = 8093;

/**
 * Central analytics ingest endpoint. Assembled at runtime from a base64 blob so
 * it is never exposed as plain text in the source, bundle, UI or docs. Fixed
 * and NOT user-configurable. (An env override exists for local tests only.)
 */
export const TELEMETRY_ENDPOINT = Buffer.from(
  "aHR0cHM6Ly9oY3UuZmFiaW9yZW5uZXIuZGUvaW5nZXN0LnBocA==",
  "base64"
).toString("utf8");

/**
 * Pseudonymization salt for the installId. The installId is
 * sha256(TELEMETRY_SALT + hcuSgtin); the raw SGTIN is never transmitted.
 */
export const TELEMETRY_SALT = "hcu-plugin-analytics/v1";
