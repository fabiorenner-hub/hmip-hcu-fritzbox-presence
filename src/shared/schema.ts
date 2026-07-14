import { z } from "zod";

/**
 * Zod schemas for the OTA (updates) and analytics configuration subsets.
 * The FRITZ!Box / presence settings are handled by the hand-rolled ConfigStore;
 * these two blocks are validated/coerced through Zod (single source of truth).
 */

export const UpdatesConfigSchema = z
  .object({
    // OTA on by default on the stable channel (per project decision).
    mode: z.enum(["manual", "auto"]).default("auto"),
    channel: z.enum(["stable", "experimental"]).default("stable"),
    checkIntervalHours: z.number().int().min(1).max(168).default(6),
  })
  .default({});

export type UpdatesConfig = z.infer<typeof UpdatesConfigSchema>;

export const AnalyticsConfigSchema = z
  .object({
    // OPT-OUT: anonymous technical usage statistics are ON by default.
    // The fixed endpoint and payload are defined in code (pluginMeta/telemetry).
    enabled: z.boolean().default(true),
  })
  .default({});

export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>;
