/**
 * Type definitions for the Homematic IP Connect API.
 *
 * All message types, field names and enum values in this file are taken
 * verbatim from the official Connect API documentation 1.0.1
 * (connect-api-documentation-1.0.1.html). Do not invent values here:
 * the HCU rejects unknown enum values and discards the whole envelope.
 */

/** PluginMessage envelope (§6.2 Envelopes). */
export interface PluginMessage<TBody = unknown> {
  /** Unique identifier of the plugin. */
  pluginId: string;
  /** Message identifier. Echo the request id for responses; fresh UUID otherwise. */
  id: string;
  /** PluginMessageType. */
  type: string;
  body?: TBody;
}

/** PluginReadinessStatus (§6.6.9). Only these three values are allowed. */
export type PluginReadinessStatus = "CONFIG_REQUIRED" | "ERROR" | "READY";

/** ConfigUpdateResponseStatus (§6.6.4). */
export type ConfigUpdateResponseStatus = "APPLIED" | "FAILED" | "PENDING";

/** PropertyType (§6.6.11). */
export type PropertyType =
  | "BOOLEAN"
  | "ENUM"
  | "INTEGER"
  | "NUMBER"
  | "PASSWORD"
  | "QRCODE"
  | "READONLY"
  | "STRING"
  | "TYPEAHEAD"
  | "WEBLINK";

/** PresenceDetected feature (§6.7.23). Required feature of OCCUPANCY_SENSOR. */
export interface PresenceDetectedFeature {
  type: "presenceDetected";
  /** true if the device has recently detected presence. */
  presenceDetected: boolean;
}

/** Maintenance feature (§6.7.16). Optional feature of OCCUPANCY_SENSOR. */
export interface MaintenanceFeature {
  type: "maintenance";
  /** true if the device is currently unreachable. */
  unreach?: boolean;
  lowBat?: boolean;
  sabotage?: boolean;
}

export type Feature = PresenceDetectedFeature | MaintenanceFeature;

/** Device (§6.5 / used in DiscoverResponse, StatusResponse). */
export interface Device {
  deviceType: string;
  deviceId: string;
  friendlyName: string;
  features: Feature[];
  modelType?: string;
  firmwareVersion?: string;
}

/** PropertyTemplate (§6.5.4). */
export interface PropertyTemplate {
  dataType: PropertyType;
  friendlyName: string;
  description?: string;
  defaultValue?: string;
  currentValue?: string;
  required?: string; // documented as string "true"/"false"
  groupId?: string;
  order?: number;
  minimum?: number;
  maximum?: number;
  minimumLength?: number;
  maximumLength?: number;
  pattern?: string;
  values?: string[];
}

/** GroupTemplate (§6.5.3). */
export interface GroupTemplate {
  friendlyName: string;
  description?: string;
  order?: number;
}

export interface ConfigTemplateBody {
  properties: Record<string, PropertyTemplate>;
  groups?: Record<string, GroupTemplate>;
}

/** Incoming CONFIG_UPDATE_REQUEST body (§6.4.x). */
export interface ConfigUpdateRequestBody {
  languageCode?: string;
  properties?: Record<string, unknown>;
}

/** Incoming STATUS_REQUEST body. */
export interface StatusRequestBody {
  deviceIds?: string[];
}

// Message type constants used by this plugin.
export const MessageType = {
  // Outgoing (plugin -> HCU)
  PLUGIN_STATE_RESPONSE: "PLUGIN_STATE_RESPONSE",
  DISCOVER_RESPONSE: "DISCOVER_RESPONSE",
  STATUS_RESPONSE: "STATUS_RESPONSE",
  STATUS_EVENT: "STATUS_EVENT",
  CONFIG_TEMPLATE_RESPONSE: "CONFIG_TEMPLATE_RESPONSE",
  CONFIG_UPDATE_RESPONSE: "CONFIG_UPDATE_RESPONSE",
  // Incoming (HCU -> plugin)
  PLUGIN_STATE_REQUEST: "PLUGIN_STATE_REQUEST",
  DISCOVER_REQUEST: "DISCOVER_REQUEST",
  STATUS_REQUEST: "STATUS_REQUEST",
  CONFIG_TEMPLATE_REQUEST: "CONFIG_TEMPLATE_REQUEST",
  CONFIG_UPDATE_REQUEST: "CONFIG_UPDATE_REQUEST",
  CONTROL_REQUEST: "CONTROL_REQUEST",
} as const;

/** DeviceType values used by this plugin (§6.6.5). */
export const DeviceType = {
  OCCUPANCY_SENSOR: "OCCUPANCY_SENSOR",
} as const;
