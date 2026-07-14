# HMIP HCU Plugin: FRITZ!Box Presence

[Deutsche Version → `README.de.md`](README.de.md)

A [Homematic IP](https://www.homematic-ip.com/) Home Control Unit (HCU) plugin
that shows **who is home**. It polls your [FRITZ!Box](https://avm.de/) for the
network devices that are currently online, maps those devices to people, and
exposes each person as an `OCCUPANCY_SENSOR` device in the Homematic IP app —
ready to use in automations, scenes and groups.

`pluginId: de.fr.renner.plugin.fritzboxpresence`

Inspired by
[timo-reymann/fritzbox-based-presence](https://github.com/timo-reymann/fritzbox-based-presence).
Built strictly against the official Connect API documentation 1.0.1 — device
types, feature schemas and enum values are taken verbatim from the spec, never
guessed.

> Heads-up: this is a personal, self-hosted hobby project, not an official
> eQ-3 or AVM product. Use at your own risk.

## Support

Found a bug or have a question? Please [open an issue](../../issues). Include
your HCU firmware version, the plugin version, your Fritz!OS version, and the
relevant lines from the Connect log (HCUweb → plugin log panel).

## Updates (over-the-air)

The plugin can update itself over the air. A small local dashboard at
`http://<your-hcu>.local:8093/` (dark theme, DE/EN) shows the installed / image
/ latest version and lets you pick an update **channel** and **mode**:

- **stable** (default) — vetted GitHub releases.
- **experimental** — rolling prereleases, delivered over the air without a new
  `.tar.gz`/HCUweb upload. For testers.
- mode **manual** (default) checks in the background and lets you install on
  demand; **auto** installs new versions on the selected channel automatically.

The **Update now** button shows a progress bar and a robust install flow
(installing → restarting → done) that survives the restart window and reloads
automatically — no more "failed to fetch".

The plugin boots through a small bootstrap loader that runs either the baked-in
image or an installed OTA payload, with **crash-loop protection**: if an OTA
payload fails to start three times it is quarantined and the plugin rolls back
to the image automatically. A stable core image always wins over an older OTA
payload. Major upgrades that need a newer core still ship as a `.tar.gz` via
HCUweb.

## What it does

- **Per-person presence.** Each configured person becomes one
  `OCCUPANCY_SENSOR` device. `PresenceDetected` is `true` while at least one of
  their devices is online on the FRITZ!Box, `false` otherwise.
- **Name or MAC matching.** Map people to devices by network name or by MAC
  address, optionally case-insensitive.
- **Arrival / departure delay.** Debounce flapping Wi-Fi: require a device to be
  online (or all offline) for a configurable grace period before flipping —
  smooths phone power-saving drop-offs.
- **Reachability.** Optional `Maintenance` feature reports `unreach` when the
  FRITZ!Box can't be reached; the plugin state turns to `ERROR` accordingly.
- **Live updates.** A `STATUS_EVENT` is sent only when a poll observes a real
  presence change (presence is read-only — there is no control command).
- **Robust login.** Standard `login_sid.lua` challenge-response with PBKDF2 and
  an MD5 fallback, covering Fritz!OS 7.57+.

## Install on your HCU

1. Download the latest `fritzbox-presence-<version>-arm64.tar.gz` from the
   [Releases](../../releases) page (or build it yourself, see below).
2. In **HCUweb → Plugins**, upload the `.tar.gz`.
3. Open the plugin's config page and set your FRITZ!Box **URL**, **username**
   and **password**, plus the **device mapping**.

The image must be `arm64` (the HCU's CPU) and uploaded as a `.tar.gz`.

### Create a FRITZ!Box user

Create a dedicated FRITZ!Box user (System → FRITZ!Box-Benutzer) that is allowed
to view the home network, and use those credentials in the plugin config.

## Build it yourself

Requirements: Node.js ≥ 20 and Docker (with `buildx` for arm64).

```bash
npm install          # install the toolchain
npm run build        # tsc → dist/
docker buildx build --platform=linux/arm64 -t fritzbox-presence:0.1.0 .
docker save fritzbox-presence:0.1.0 | gzip > fritzbox-presence-0.1.0-arm64.tar.gz
```

Then upload the resulting `.tar.gz` via HCUweb.

For local development against an exposed HCU WebSocket:

```bash
node dist/index.js <plugin-id> <hcu-host> <authtoken-file>
```

## Configuration

All settings are editable on the plugin's config page in HCUweb, grouped into
four sections.

**FRITZ!Box**

| Setting | Type | Required | Notes |
|---|---|---|---|
| FRITZ!Box URL | string | yes | e.g. `http://192.168.178.1` |
| Username | string | yes | FRITZ!Box user allowed to view the home network |
| Password | password | yes | never echoed back; keep the `********` placeholder to retain it |
| Ignore TLS certificates | boolean | no | only for `https://` with self-signed certs |
| Request timeout (seconds) | integer | no | HTTP timeout, 1–120, default 10 |

**Presence**

| Setting | Type | Required | Notes |
|---|---|---|---|
| Device mapping | string | yes | `Person=id1,id2\|Person2=id3` |
| Match by | string | no | `name` or `mac` (default `name`) |
| Case-insensitive matching | boolean | no | ignore case when matching ids |
| Poll interval (seconds) | integer | no | 5–3600, default 30 |
| Arrival delay (seconds) | integer | no | online this long before "present" (0 = immediate) |
| Departure delay (seconds) | integer | no | offline this long before "away" |

**Advanced**

| Setting | Type | Required | Notes |
|---|---|---|---|
| Report reachability | boolean | no | include the `Maintenance` feature, default on |
| Device model name | string | no | model name reported for the devices |
| Log level | string | no | `error`, `warn`, `info`, `debug` (default `info`) |

**About** — read-only version info and a documentation link.

> Choice fields (`Match by`, `Log level`) use `STRING` with a documented value
> pattern instead of `ENUM`, which currently renders as an empty dropdown in
> HCUweb builds.

Configuration is persisted to `CONFIG_PATH` (defaults to `/data/config.json`
when installed).

## How presence maps to the Connect API

- **Device type**: `OCCUPANCY_SENSOR` (spec §6.6.5)
- **`PresenceDetected`** (§6.7.23, required) — `true` = home, `false` = away
- **`Maintenance`** (§6.7.16, optional) — `unreach = true` while the FRITZ!Box
  is unreachable
- Lifecycle via `PluginStateResponse` / `PluginReadinessStatus` (§6.6.9:
  `CONFIG_REQUIRED` · `ERROR` · `READY`), device sync via `DISCOVER_RESPONSE` /
  `STATUS_RESPONSE`, live changes via `STATUS_EVENT`.

## Troubleshooting

- **Plugin state stays `CONFIG_REQUIRED`** → URL, username, password or mapping
  is missing.
- **Plugin state `ERROR`** → FRITZ!Box login or connection failed; check the URL
  and credentials, and the plugin log.
- **A person never appears present** → the configured device name/MAC must match
  exactly what the FRITZ!Box shows under Heimnetz; try `Match by = mac` or
  enable case-insensitive matching.
- **Presence flaps** → increase the departure delay (phones drop Wi-Fi to save
  power).
- **Connect log shows `ERROR_RESPONSE` / deserialization errors** → a feature or
  enum value was rejected by the HCU; check the plugin version is current.

## Author

Fabio Renner ([@fabiorenner-hub](https://github.com/fabiorenner-hub)).

### Third-party components

- [ws](https://github.com/websockets/ws) — WebSocket client (MIT).
- [uuid](https://github.com/uuidjs/uuid) — message ids (MIT).
- Inspired by [fritzbox-based-presence](https://github.com/timo-reymann/fritzbox-based-presence) (Apache-2.0).

## License

[Apache License 2.0](LICENSE).
