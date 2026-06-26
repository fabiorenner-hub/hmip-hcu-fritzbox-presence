# HMIP HCU FRITZ!Box Presence — multi-stage container build.
#
# Build stage : standard `node:20-alpine` (multi-arch, ships npm + tsc).
# Runtime stage: HMIP's `alpine-node-typescript:0.0.1` (arm64-only — the
# HCU's CPU). The HMIP runtime image is intentionally minimal: it ships
# `node` but NOT `npm`, so we cannot install there. The build stage
# prunes dev deps and the runtime stage copies the resulting
# `node_modules/` over.
#
# The HCU runs arm64. Build on an x86_64 host with:
#   docker buildx build --platform=linux/arm64 -t fritzbox-presence:0.1.0 .
# Plain `docker build` on x86_64 also works because the runtime stage is
# pinned to `--platform=linux/arm64` (QEMU handles cross-execution).

# ---- Build stage ---------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:20-alpine AS build

WORKDIR /build

# Install full deps (incl. dev deps for tsc).
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Compile TypeScript -> dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies so the runtime stage can reuse node_modules/
# without needing npm itself.
RUN npm prune --omit=dev

# ---- Runtime stage -------------------------------------------------------
FROM ghcr.io/homematicip/alpine-node-typescript:0.0.1 AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /build/package.json ./package.json
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist

# Plugin metadata for the HCU plugin manager. JSON is single-line so
# `docker inspect --format` parses it cleanly.
#
# Field types are strictly enforced by the HCU validator on upload:
#   - friendlyName / description : Map<String,String> (ISO-639-1 keys)
#   - changelog                  : String (NOT a map — a map causes
#                                  "Plugin nicht valide" on upload)
#   - logsEnabled                : boolean (enables the HCUweb log view)
LABEL de.eq3.hmip.plugin.metadata='{"pluginId":"de.fr.renner.plugin.fritzboxpresence","version":"0.1.0","issuer":"Fabio Renner","hcuMinVersion":"1.4.7","scope":"LOCAL","friendlyName":{"de":"FRITZ!Box Anwesenheit","en":"FRITZ!Box Presence"},"description":{"de":"Zeigt als Anwesenheitssensoren, wer zuhause ist — basierend auf den an der FRITZ!Box online befindlichen Geräten.","en":"Shows who is home as presence sensors, based on the devices currently online on your FRITZ!Box."},"changelog":"0.1.0 — Erste Version: pro Person ein OCCUPANCY_SENSOR, Anwesenheit aus an der FRITZ!Box online befindlichen Geräten, Mapping nach Name oder MAC, Ankunfts-/Abgangsverzögerung, konfigurierbares Poll-Intervall. / Initial release: one OCCUPANCY_SENSOR per person, presence derived from devices online on the FRITZ!Box, mapping by name or MAC, arrival/departure delay, configurable poll interval.","logsEnabled":true}'

# The first argument MUST equal the metadata "pluginId" above; it is also
# sent as the WebSocket "plugin-id" header. When installed on the HCU the
# host is "host.containers.internal" and the auth token is mounted at /TOKEN.
ENTRYPOINT ["node", "dist/index.js", "de.fr.renner.plugin.fritzboxpresence", "host.containers.internal", "/TOKEN"]
