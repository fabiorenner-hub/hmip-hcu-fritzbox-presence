import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { log } from "../logger";
import { ConfigStore } from "../config";
import { FritzBoxClient, FritzBoxAuthError } from "../fritzbox/client";
import { Person, parseMapping, computePresence } from "../presence/mapping";
import {
  Device,
  Feature,
  MessageType,
  DeviceType,
  PluginMessage,
  PluginReadinessStatus,
  ConfigUpdateRequestBody,
  ConfigUpdateResponseStatus,
  StatusRequestBody,
} from "./types";

const PLUGIN_VERSION = "0.1.0";

interface PluginOptions {
  pluginId: string;
  host: string;
  authToken: string;
  config: ConfigStore;
}

/** Per-device presence tracking with debounce support. */
interface PresenceState {
  /** The presence value currently reported to the HCU. */
  reported: boolean;
  /** Timestamp (ms) since the raw value started differing from `reported`. */
  pendingSince?: number;
}

export class FritzBoxPresencePlugin {
  private readonly pluginId: string;
  private readonly host: string;
  private readonly authToken: string;
  private readonly config: ConfigStore;

  private ws?: WebSocket;
  private fritzBox?: FritzBoxClient;
  private people: Person[] = [];

  /** Last known presence per deviceId. */
  private presenceState = new Map<string, PresenceState>();
  /** Whether the FRITZ!Box was reachable on the last poll. */
  private reachable = false;
  private lastError?: string;
  private initialized = false;
  private pollTimer?: NodeJS.Timeout;

  constructor(opts: PluginOptions) {
    this.pluginId = opts.pluginId;
    this.host = opts.host;
    this.authToken = opts.authToken;
    this.config = opts.config;
    this.rebuildFromConfig();
  }

  start(): void {
    this.connect();
  }

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle
  // ---------------------------------------------------------------------------

  private connect(): void {
    const url = `wss://${this.host}:9001`;
    log.info("ws", `Connecting to ${url}`);

    this.ws = new WebSocket(url, {
      rejectUnauthorized: false,
      headers: {
        authtoken: this.authToken,
        "plugin-id": this.pluginId,
      },
    });

    this.ws.on("open", () => {
      log.info("ws", "Connected to Connect API WebSocket");
      this.sendPluginState(uuidv4());
      this.startPolling();
    });

    this.ws.on("message", (data) => this.handleMessage(data));

    this.ws.on("error", (err) => {
      log.error("ws", "WebSocket error", err);
    });

    this.ws.on("close", (code) => {
      log.warn("ws", `WebSocket closed (code ${code}), reconnecting in 5s`);
      this.stopPolling();
      setTimeout(() => this.connect(), 5000);
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let message: PluginMessage;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      log.error("ws", "Received non-JSON message", err);
      return;
    }

    switch (message.type) {
      case MessageType.PLUGIN_STATE_REQUEST:
        this.sendPluginState(message.id);
        break;
      case MessageType.CONFIG_TEMPLATE_REQUEST:
        this.sendConfigTemplate(message.id);
        break;
      case MessageType.CONFIG_UPDATE_REQUEST:
        this.handleConfigUpdate(message);
        break;
      case MessageType.DISCOVER_REQUEST:
        this.sendDiscoverResponse(message.id);
        break;
      case MessageType.STATUS_REQUEST:
        this.sendStatusResponse(message);
        break;
      case MessageType.CONTROL_REQUEST:
        // Occupancy sensors are read-only; nothing to control.
        log.info("plugin", "Ignoring CONTROL_REQUEST (presence sensors are read-only)");
        break;
      default:
        // Unhandled message types (e.g. inclusion/exclusion) are ignored for 0.1.
        break;
    }
  }

  private send(message: PluginMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn("ws", `Cannot send ${message.type}: socket not open`);
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  // ---------------------------------------------------------------------------
  // Outgoing messages
  // ---------------------------------------------------------------------------

  private currentReadiness(): PluginReadinessStatus {
    if (!this.config.isComplete()) return "CONFIG_REQUIRED";
    if (this.lastError) return "ERROR";
    return "READY";
  }

  private sendPluginState(id: string): void {
    this.send({
      pluginId: this.pluginId,
      id,
      type: MessageType.PLUGIN_STATE_RESPONSE,
      body: {
        pluginReadinessStatus: this.currentReadiness(),
        friendlyName: {
          de: "FRITZ!Box Anwesenheit",
          en: "FRITZ!Box Presence",
        },
      },
    });
  }

  private sendConfigTemplate(id: string): void {
    this.send({
      pluginId: this.pluginId,
      id,
      type: MessageType.CONFIG_TEMPLATE_RESPONSE,
      body: this.config.buildTemplate(),
    });
  }

  private handleConfigUpdate(message: PluginMessage): void {
    const body = (message.body ?? {}) as ConfigUpdateRequestBody;
    let status: ConfigUpdateResponseStatus = "APPLIED";
    let feedback: string | undefined;

    try {
      this.config.applyUpdate(body.properties ?? {});
      this.rebuildFromConfig();
      this.lastError = undefined;
      this.initialized = false;
    } catch (err) {
      status = "FAILED";
      feedback = err instanceof Error ? err.message : "Failed to apply configuration";
      log.error("config", "Failed to apply configuration update", err);
    }

    this.send({
      pluginId: this.pluginId,
      id: message.id,
      type: MessageType.CONFIG_UPDATE_RESPONSE,
      body: feedback ? { status, message: feedback } : { status },
    });

    // Reflect the new readiness and restart polling against new settings.
    this.sendPluginState(uuidv4());
    this.startPolling();
  }

  private buildDevice(person: Person): Device {
    const present = this.presenceState.get(person.deviceId)?.reported ?? false;
    return {
      deviceType: DeviceType.OCCUPANCY_SENSOR,
      deviceId: person.deviceId,
      friendlyName: person.name,
      modelType: this.config.get().modelType,
      firmwareVersion: PLUGIN_VERSION,
      features: this.buildFeatures(present),
    };
  }

  private buildFeatures(present: boolean): Feature[] {
    const features: Feature[] = [{ type: "presenceDetected", presenceDetected: present }];
    if (this.config.get().emitMaintenance) {
      features.push({ type: "maintenance", unreach: !this.reachable });
    }
    return features;
  }

  private sendDiscoverResponse(id: string): void {
    this.send({
      pluginId: this.pluginId,
      id,
      type: MessageType.DISCOVER_RESPONSE,
      body: {
        success: true,
        devices: this.people.map((p) => this.buildDevice(p)),
      },
    });
  }

  private sendStatusResponse(message: PluginMessage): void {
    const body = (message.body ?? {}) as StatusRequestBody;
    const requested = body.deviceIds;
    const devices = this.people
      .filter((p) => !requested || requested.includes(p.deviceId))
      .map((p) => this.buildDevice(p));

    this.send({
      pluginId: this.pluginId,
      id: message.id,
      type: MessageType.STATUS_RESPONSE,
      body: { success: true, devices },
    });
  }

  /**
   * Emit a partial STATUS_EVENT for a single device. Only used when polling
   * observes a presence change that the HCU did not request (see steering:
   * "live-poll detects a change while no command is pending").
   */
  private sendStatusEvent(deviceId: string, present: boolean): void {
    this.send({
      pluginId: this.pluginId,
      id: uuidv4(),
      type: MessageType.STATUS_EVENT,
      body: {
        deviceId,
        features: this.buildFeatures(present),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private rebuildFromConfig(): void {
    const cfg = this.config.get();
    this.people = parseMapping(cfg.deviceNameMapping);
    if (this.config.isComplete()) {
      this.fritzBox = new FritzBoxClient({
        baseUrl: cfg.fritzBoxUrl,
        username: cfg.fritzBoxUsername,
        password: cfg.fritzBoxPassword,
        ignoreCertificates: cfg.ignoreCertificates,
        timeoutSeconds: cfg.requestTimeoutSeconds,
      });
    } else {
      this.fritzBox = undefined;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.config.isComplete() || !this.fritzBox) {
      log.info("plugin", "Configuration incomplete, polling not started");
      return;
    }
    const intervalMs = this.config.get().pollIntervalSeconds * 1000;
    log.info("plugin", `Starting presence polling every ${intervalMs / 1000}s`);
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), intervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (!this.fritzBox) return;

    let devices;
    try {
      devices = await this.fritzBox.getNetDevices();
      this.reachable = true;
      if (this.lastError) {
        this.lastError = undefined;
        this.sendPluginState(uuidv4());
      }
    } catch (err) {
      this.reachable = false;
      const msg =
        err instanceof FritzBoxAuthError
          ? `FRITZ!Box authentication failed: ${err.message}`
          : `FRITZ!Box request failed: ${err instanceof Error ? err.message : String(err)}`;
      if (this.lastError !== msg) {
        this.lastError = msg;
        log.error("fritzbox", msg);
        this.sendPluginState(uuidv4());
      }
      return;
    }

    const cfg = this.config.get();
    const next = computePresence(this.people, devices, {
      matchBy: cfg.matchBy,
      caseInsensitive: cfg.caseInsensitiveMatch,
    });

    if (!this.initialized) {
      // First successful poll: seed state without emitting change events.
      this.presenceState = new Map(
        [...next].map(([deviceId, present]) => [deviceId, { reported: present }])
      );
      this.initialized = true;
      log.info("plugin", `Initial presence captured for ${this.people.length} person(s)`);
      return;
    }

    const now = Date.now();
    const arrivalDelayMs = cfg.arrivalDelaySeconds * 1000;
    const departureDelayMs = cfg.departureDelaySeconds * 1000;

    for (const [deviceId, raw] of next) {
      let state = this.presenceState.get(deviceId);
      if (!state) {
        state = { reported: raw };
        this.presenceState.set(deviceId, state);
        continue;
      }

      if (raw === state.reported) {
        // Raw matches reported again: cancel any pending transition.
        state.pendingSince = undefined;
        continue;
      }

      // Raw differs from what we report: apply the debounce delay.
      if (state.pendingSince === undefined) {
        state.pendingSince = now;
      }
      const requiredDelay = raw ? arrivalDelayMs : departureDelayMs;
      if (now - state.pendingSince >= requiredDelay) {
        state.reported = raw;
        state.pendingSince = undefined;
        const person = this.people.find((p) => p.deviceId === deviceId);
        log.info("presence", `${person?.name ?? deviceId} is now ${raw ? "present" : "away"}`);
        this.sendStatusEvent(deviceId, raw);
      } else {
        log.debug(
          "presence",
          `${deviceId} pending ${raw ? "arrival" : "departure"} (${Math.round(
            (now - state.pendingSince) / 1000
          )}s/${requiredDelay / 1000}s)`
        );
      }
    }

    // Drop tracking for devices that no longer exist in the mapping.
    for (const deviceId of [...this.presenceState.keys()]) {
      if (!next.has(deviceId)) {
        this.presenceState.delete(deviceId);
      }
    }
  }
}
