/**
 * Minimal structured logger with a runtime-adjustable level. Writes to
 * stdout/stderr so the HCU can capture the plugin container logs
 * (LABEL logsEnabled=true).
 */
type Component = "plugin" | "ws" | "fritzbox" | "config" | "presence";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: LogLevel = "info";

function ts(): string {
  return new Date().toISOString();
}

function enabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
}

export const log = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },
  getLevel(): LogLevel {
    return currentLevel;
  },
  debug(component: Component, message: string): void {
    if (!enabled("debug")) return;
    // eslint-disable-next-line no-console
    console.log(`${ts()} [DEBUG] [${component}] ${message}`);
  },
  info(component: Component, message: string): void {
    if (!enabled("info")) return;
    // eslint-disable-next-line no-console
    console.log(`${ts()} [INFO] [${component}] ${message}`);
  },
  warn(component: Component, message: string): void {
    if (!enabled("warn")) return;
    // eslint-disable-next-line no-console
    console.warn(`${ts()} [WARN] [${component}] ${message}`);
  },
  error(component: Component, message: string, err?: unknown): void {
    if (!enabled("error")) return;
    const detail = err instanceof Error ? `: ${err.message}` : err ? `: ${String(err)}` : "";
    // eslint-disable-next-line no-console
    console.error(`${ts()} [ERROR] [${component}] ${message}${detail}`);
  },
};
