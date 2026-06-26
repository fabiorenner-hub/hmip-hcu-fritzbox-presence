import * as fs from "fs";
import * as path from "path";
import { ConfigTemplateBody, PropertyTemplate, GroupTemplate } from "./connect/types";
import { LogLevel, log } from "./logger";

/**
 * Persistent plugin configuration. The HCU pushes config values via
 * CONFIG_UPDATE_REQUEST; we persist them and report them back as
 * `currentValue` in the CONFIG_TEMPLATE_RESPONSE.
 */
export type MatchBy = "name" | "mac";

export interface PluginConfig {
  // Connection
  fritzBoxUrl: string;
  fritzBoxUsername: string;
  fritzBoxPassword: string;
  ignoreCertificates: boolean;
  requestTimeoutSeconds: number;

  // Presence / mapping
  /** Format: "Person=id1,id2|Person2=id3" where id is a device name or MAC. */
  deviceNameMapping: string;
  matchBy: MatchBy;
  caseInsensitiveMatch: boolean;
  pollIntervalSeconds: number;
  arrivalDelaySeconds: number;
  departureDelaySeconds: number;

  // Advanced
  emitMaintenance: boolean;
  modelType: string;
  logLevel: LogLevel;
}

const DEFAULTS: PluginConfig = {
  fritzBoxUrl: "http://192.168.178.1",
  fritzBoxUsername: "",
  fritzBoxPassword: "",
  ignoreCertificates: false,
  requestTimeoutSeconds: 10,

  deviceNameMapping: "",
  matchBy: "name",
  caseInsensitiveMatch: false,
  pollIntervalSeconds: 30,
  arrivalDelaySeconds: 0,
  departureDelaySeconds: 0,

  emitMaintenance: true,
  modelType: "FRITZBOX-PRESENCE",
  logLevel: "info",
};

// Property identifiers (keys) used in the config template and updates.
export const PropertyId = {
  fritzBoxUrl: "fritzBoxUrl",
  fritzBoxUsername: "fritzBoxUsername",
  fritzBoxPassword: "fritzBoxPassword",
  ignoreCertificates: "ignoreCertificates",
  requestTimeoutSeconds: "requestTimeoutSeconds",
  deviceNameMapping: "deviceNameMapping",
  matchBy: "matchBy",
  caseInsensitiveMatch: "caseInsensitiveMatch",
  pollIntervalSeconds: "pollIntervalSeconds",
  arrivalDelaySeconds: "arrivalDelaySeconds",
  departureDelaySeconds: "departureDelaySeconds",
  emitMaintenance: "emitMaintenance",
  modelType: "modelType",
  logLevel: "logLevel",
  // Informational, read-only properties.
  pluginInfo: "pluginInfo",
  projectLink: "projectLink",
} as const;

const GROUP_CONNECTION = "connection";
const GROUP_MAPPING = "mapping";
const GROUP_ADVANCED = "advanced";
const GROUP_INFO = "info";

const MATCH_BY_VALUES: MatchBy[] = ["name", "mac"];
const LOG_LEVEL_VALUES: LogLevel[] = ["error", "warn", "info", "debug"];
const PLUGIN_VERSION = "0.1.0";

export class ConfigStore {
  private current: PluginConfig;
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath || process.env.CONFIG_PATH || path.join(process.cwd(), "config.json");
    this.current = this.load();
    log.setLevel(this.current.logLevel);
  }

  get(): PluginConfig {
    return this.current;
  }

  private load(): PluginConfig {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<PluginConfig>;
        log.info("config", `Loaded configuration from ${this.filePath}`);
        return this.sanitize({ ...DEFAULTS, ...parsed });
      }
    } catch (err) {
      log.error("config", `Failed to read config file, using defaults`, err);
    }
    return { ...DEFAULTS };
  }

  private sanitize(c: PluginConfig): PluginConfig {
    return {
      ...c,
      matchBy: MATCH_BY_VALUES.includes(c.matchBy) ? c.matchBy : DEFAULTS.matchBy,
      logLevel: LOG_LEVEL_VALUES.includes(c.logLevel) ? c.logLevel : DEFAULTS.logLevel,
      requestTimeoutSeconds: clamp(num(c.requestTimeoutSeconds, DEFAULTS.requestTimeoutSeconds), 1, 120),
      pollIntervalSeconds: clamp(num(c.pollIntervalSeconds, DEFAULTS.pollIntervalSeconds), 5, 3600),
      arrivalDelaySeconds: clamp(num(c.arrivalDelaySeconds, DEFAULTS.arrivalDelaySeconds), 0, 3600),
      departureDelaySeconds: clamp(num(c.departureDelaySeconds, DEFAULTS.departureDelaySeconds), 0, 3600),
      modelType: c.modelType?.trim() || DEFAULTS.modelType,
    };
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.current, null, 2), "utf8");
      log.info("config", `Persisted configuration to ${this.filePath}`);
    } catch (err) {
      log.error("config", `Failed to persist config file`, err);
    }
  }

  /**
   * Apply a CONFIG_UPDATE_REQUEST properties map. Unknown keys are ignored,
   * missing keys keep their current value. Read-only/informational properties
   * are never written. Returns the new config.
   */
  applyUpdate(properties: Record<string, unknown>): PluginConfig {
    const next: PluginConfig = { ...this.current };

    const str = (key: string): string | undefined =>
      typeof properties[key] === "string" ? (properties[key] as string) : undefined;

    if (str(PropertyId.fritzBoxUrl) !== undefined) next.fritzBoxUrl = str(PropertyId.fritzBoxUrl)!.trim();
    if (str(PropertyId.fritzBoxUsername) !== undefined) next.fritzBoxUsername = str(PropertyId.fritzBoxUsername)!.trim();
    // Only overwrite the password when a non-empty, non-placeholder value is sent.
    const pw = str(PropertyId.fritzBoxPassword);
    if (pw !== undefined && pw.length > 0 && !/^\*+$/.test(pw)) {
      next.fritzBoxPassword = pw;
    }
    if (str(PropertyId.deviceNameMapping) !== undefined) next.deviceNameMapping = str(PropertyId.deviceNameMapping)!.trim();
    if (str(PropertyId.modelType) !== undefined) next.modelType = str(PropertyId.modelType)!.trim() || DEFAULTS.modelType;

    const matchBy = str(PropertyId.matchBy);
    if (matchBy !== undefined) {
      next.matchBy = MATCH_BY_VALUES.includes(matchBy as MatchBy) ? (matchBy as MatchBy) : DEFAULTS.matchBy;
    }
    const logLevel = str(PropertyId.logLevel);
    if (logLevel !== undefined) {
      next.logLevel = LOG_LEVEL_VALUES.includes(logLevel as LogLevel) ? (logLevel as LogLevel) : DEFAULTS.logLevel;
    }

    if (properties[PropertyId.ignoreCertificates] !== undefined) next.ignoreCertificates = toBoolean(properties[PropertyId.ignoreCertificates]);
    if (properties[PropertyId.caseInsensitiveMatch] !== undefined) next.caseInsensitiveMatch = toBoolean(properties[PropertyId.caseInsensitiveMatch]);
    if (properties[PropertyId.emitMaintenance] !== undefined) next.emitMaintenance = toBoolean(properties[PropertyId.emitMaintenance]);

    if (properties[PropertyId.requestTimeoutSeconds] !== undefined) next.requestTimeoutSeconds = clamp(num(properties[PropertyId.requestTimeoutSeconds], next.requestTimeoutSeconds), 1, 120);
    if (properties[PropertyId.pollIntervalSeconds] !== undefined) next.pollIntervalSeconds = clamp(num(properties[PropertyId.pollIntervalSeconds], next.pollIntervalSeconds), 5, 3600);
    if (properties[PropertyId.arrivalDelaySeconds] !== undefined) next.arrivalDelaySeconds = clamp(num(properties[PropertyId.arrivalDelaySeconds], next.arrivalDelaySeconds), 0, 3600);
    if (properties[PropertyId.departureDelaySeconds] !== undefined) next.departureDelaySeconds = clamp(num(properties[PropertyId.departureDelaySeconds], next.departureDelaySeconds), 0, 3600);

    this.current = next;
    log.setLevel(this.current.logLevel);
    this.persist();
    return this.current;
  }

  /** True when all mandatory connection/mapping fields are present. */
  isComplete(): boolean {
    const c = this.current;
    return (
      c.fritzBoxUrl.length > 0 &&
      c.fritzBoxUsername.length > 0 &&
      c.fritzBoxPassword.length > 0 &&
      c.deviceNameMapping.length > 0
    );
  }

  /**
   * Build the CONFIG_TEMPLATE_RESPONSE body.
   *
   * Notes:
   * - The password is never echoed back; only a placeholder when one is stored.
   * - Choice fields (matchBy, logLevel) use dataType STRING with documented
   *   allowed values instead of ENUM, which currently renders as an empty
   *   dropdown in HCUweb builds.
   */
  buildTemplate(): ConfigTemplateBody {
    const c = this.current;

    const groups: Record<string, GroupTemplate> = {
      [GROUP_CONNECTION]: { friendlyName: "FRITZ!Box", description: "Connection settings for your FRITZ!Box.", order: 1 },
      [GROUP_MAPPING]: { friendlyName: "Presence", description: "Map network devices to people and tune detection.", order: 2 },
      [GROUP_ADVANCED]: { friendlyName: "Advanced", description: "Behaviour and diagnostics.", order: 3 },
      [GROUP_INFO]: { friendlyName: "About", description: "Plugin information.", order: 4 },
    };

    const properties: Record<string, PropertyTemplate> = {
      [PropertyId.fritzBoxUrl]: {
        dataType: "STRING",
        friendlyName: "FRITZ!Box URL",
        description: "Base URL of the FRITZ!Box web UI, e.g. http://192.168.178.1",
        defaultValue: DEFAULTS.fritzBoxUrl,
        currentValue: c.fritzBoxUrl,
        required: "true",
        groupId: GROUP_CONNECTION,
        order: 1,
      },
      [PropertyId.fritzBoxUsername]: {
        dataType: "STRING",
        friendlyName: "Username",
        description: "FRITZ!Box user allowed to view the home network.",
        currentValue: c.fritzBoxUsername,
        required: "true",
        groupId: GROUP_CONNECTION,
        order: 2,
      },
      [PropertyId.fritzBoxPassword]: {
        dataType: "PASSWORD",
        friendlyName: "Password",
        description: "Password of the FRITZ!Box user. Leave the placeholder unchanged to keep the stored password.",
        currentValue: c.fritzBoxPassword.length > 0 ? "********" : "",
        required: "true",
        groupId: GROUP_CONNECTION,
        order: 3,
      },
      [PropertyId.ignoreCertificates]: {
        dataType: "BOOLEAN",
        friendlyName: "Ignore TLS certificates",
        description: "Skip TLS certificate validation (only for https:// with self-signed certs).",
        defaultValue: "false",
        currentValue: String(c.ignoreCertificates),
        groupId: GROUP_CONNECTION,
        order: 4,
      },
      [PropertyId.requestTimeoutSeconds]: {
        dataType: "INTEGER",
        friendlyName: "Request timeout (seconds)",
        description: "How long to wait for a FRITZ!Box HTTP response before failing.",
        defaultValue: String(DEFAULTS.requestTimeoutSeconds),
        currentValue: String(c.requestTimeoutSeconds),
        minimum: 1,
        maximum: 120,
        groupId: GROUP_CONNECTION,
        order: 5,
      },

      [PropertyId.deviceNameMapping]: {
        dataType: "STRING",
        friendlyName: "Device mapping",
        description: "Map devices to people. Format: Person=id1,id2|Person2=id3 (id is a device name or MAC, see 'Match by').",
        currentValue: c.deviceNameMapping,
        required: "true",
        groupId: GROUP_MAPPING,
        order: 1,
        maximumLength: 4000,
      },
      [PropertyId.matchBy]: {
        dataType: "STRING",
        friendlyName: "Match by",
        description: "Whether mapping identifiers are device names or MAC addresses. Allowed values: name, mac",
        defaultValue: DEFAULTS.matchBy,
        currentValue: c.matchBy,
        pattern: "^(name|mac)$",
        groupId: GROUP_MAPPING,
        order: 2,
      },
      [PropertyId.caseInsensitiveMatch]: {
        dataType: "BOOLEAN",
        friendlyName: "Case-insensitive matching",
        description: "Ignore upper/lower case when matching device identifiers.",
        defaultValue: "false",
        currentValue: String(c.caseInsensitiveMatch),
        groupId: GROUP_MAPPING,
        order: 3,
      },
      [PropertyId.pollIntervalSeconds]: {
        dataType: "INTEGER",
        friendlyName: "Poll interval (seconds)",
        description: "How often to poll the FRITZ!Box for online devices.",
        defaultValue: String(DEFAULTS.pollIntervalSeconds),
        currentValue: String(c.pollIntervalSeconds),
        minimum: 5,
        maximum: 3600,
        groupId: GROUP_MAPPING,
        order: 4,
      },
      [PropertyId.arrivalDelaySeconds]: {
        dataType: "INTEGER",
        friendlyName: "Arrival delay (seconds)",
        description: "A device must stay online this long before the person is marked present (0 = immediate).",
        defaultValue: String(DEFAULTS.arrivalDelaySeconds),
        currentValue: String(c.arrivalDelaySeconds),
        minimum: 0,
        maximum: 3600,
        groupId: GROUP_MAPPING,
        order: 5,
      },
      [PropertyId.departureDelaySeconds]: {
        dataType: "INTEGER",
        friendlyName: "Departure delay (seconds)",
        description: "All devices must stay offline this long before the person is marked away. Helps with Wi-Fi power-saving drop-offs.",
        defaultValue: String(DEFAULTS.departureDelaySeconds),
        currentValue: String(c.departureDelaySeconds),
        minimum: 0,
        maximum: 3600,
        groupId: GROUP_MAPPING,
        order: 6,
      },

      [PropertyId.emitMaintenance]: {
        dataType: "BOOLEAN",
        friendlyName: "Report reachability",
        description: "Include the Maintenance feature so devices show 'unreachable' when the FRITZ!Box can't be reached.",
        defaultValue: "true",
        currentValue: String(c.emitMaintenance),
        groupId: GROUP_ADVANCED,
        order: 1,
      },
      [PropertyId.modelType]: {
        dataType: "STRING",
        friendlyName: "Device model name",
        description: "Model name reported for the presence devices.",
        defaultValue: DEFAULTS.modelType,
        currentValue: c.modelType,
        groupId: GROUP_ADVANCED,
        order: 2,
        maximumLength: 64,
      },
      [PropertyId.logLevel]: {
        dataType: "STRING",
        friendlyName: "Log level",
        description: "Verbosity of the plugin log. Allowed values: error, warn, info, debug",
        defaultValue: DEFAULTS.logLevel,
        currentValue: c.logLevel,
        pattern: "^(error|warn|info|debug)$",
        groupId: GROUP_ADVANCED,
        order: 3,
      },

      [PropertyId.pluginInfo]: {
        dataType: "READONLY",
        friendlyName: "Version",
        description: "Installed plugin version.",
        currentValue: `FRITZ!Box Presence ${PLUGIN_VERSION}`,
        groupId: GROUP_INFO,
        order: 1,
      },
      [PropertyId.projectLink]: {
        dataType: "WEBLINK",
        friendlyName: "Documentation",
        description: "Open the project documentation.",
        currentValue: "https://github.com/timo-reymann/fritzbox-based-presence",
        defaultValue: "Inspired by fritzbox-based-presence",
        groupId: GROUP_INFO,
        order: 2,
      },
    };

    return { groups, properties };
  }
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
