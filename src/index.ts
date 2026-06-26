import * as fs from "fs";
import { log } from "./logger";
import { ConfigStore } from "./config";
import { FritzBoxPresencePlugin } from "./connect/plugin";

/**
 * Entrypoint. Invoked like the official eQ-3 node examples:
 *   node dist/index.js <plugin-id> <hcu-host> <authtoken-file>
 *
 * When installed on the HCU, <hcu-host> is "host.containers.internal" and the
 * auth token is mounted at the path passed as <authtoken-file>.
 */
async function main(): Promise<void> {
  const [pluginId, host, authTokenFile] = process.argv.slice(2);

  if (!pluginId || !host || !authTokenFile) {
    log.error(
      "plugin",
      "Usage: node dist/index.js <plugin-id> <hcu-host> <authtoken-file>"
    );
    process.exit(1);
    return;
  }

  let authToken: string;
  try {
    authToken = fs.readFileSync(authTokenFile, "utf8").trim();
  } catch (err) {
    log.error("plugin", `Failed to read auth token from ${authTokenFile}`, err);
    process.exit(1);
    return;
  }

  const config = new ConfigStore();
  const plugin = new FritzBoxPresencePlugin({ pluginId, host, authToken, config });

  log.info("plugin", `Starting FRITZ!Box presence plugin (${pluginId})`);
  plugin.start();
}

void main();
