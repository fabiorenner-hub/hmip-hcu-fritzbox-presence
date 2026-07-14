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

/** Central "HCU Plugin Analytics" ingest endpoint (fixed; env override for tests). */
export const TELEMETRY_ENDPOINT = "https://hcu.fabiorenner.de/ingest.php";

/**
 * Pseudonymization salt for the installId. The installId is
 * sha256(TELEMETRY_SALT + hcuSgtin); the raw SGTIN is never transmitted.
 */
export const TELEMETRY_SALT = "hcu-plugin-analytics/v1";
