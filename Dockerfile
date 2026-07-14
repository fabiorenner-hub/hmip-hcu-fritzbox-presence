# HMIP HCU FRITZ!Box Presence — multi-stage container build.
#
# Build stage : node:20-alpine (ships npm + esbuild toolchain).
# Runtime     : ghcr.io/homematicip/alpine-node-simple:0.0.1 — ships node and
#               is QEMU-safe (alpine-node-typescript throws an ICU error under
#               emulation, per the steering notes). The runtime does not need
#               npm: the app is an esbuild bundle.
#
# The HCU runs arm64. Build with:
#   docker buildx build --platform=linux/arm64 -t fritzbox-presence:0.2.0 .

ARG FRITZBOXPRESENCE_VERSION=0.2.1
ARG FRITZBOXPRESENCE_BUILD=dev

# ---- Build stage ---------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:20-alpine AS build

WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
# esbuild bundle -> dist/bootstrap/loader.js + dist/plugin/index.js
RUN npm run build
RUN npm prune --omit=dev

# ---- Runtime stage -------------------------------------------------------
FROM ghcr.io/homematicip/alpine-node-simple:0.0.1 AS runtime

ARG FRITZBOXPRESENCE_VERSION
ARG FRITZBOXPRESENCE_BUILD
ENV NODE_ENV=production \
    FRITZBOXPRESENCE_VERSION=${FRITZBOXPRESENCE_VERSION} \
    FRITZBOXPRESENCE_BUILD=${FRITZBOXPRESENCE_BUILD}

WORKDIR /app
COPY --from=build /build/package.json ./package.json
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist

# Plugin metadata for the HCU plugin manager (single-line JSON; validator is
# strict). changelog is a STRING (a map causes "Plugin nicht valide") and must
# not contain % or single quotes.
LABEL de.eq3.hmip.plugin.metadata='{"pluginId":"de.fr.renner.plugin.fritzboxpresence","version":"0.2.1","issuer":"Fabio Renner","hcuMinVersion":"1.4.7","scope":"LOCAL","friendlyName":{"de":"FRITZ!Box Anwesenheit","en":"FRITZ!Box Presence"},"description":{"de":"Zeigt als Anwesenheitssensoren, wer zuhause ist — basierend auf den an der FRITZ!Box online befindlichen Geräten.","en":"Shows who is home as presence sensors, based on the devices currently online on your FRITZ!Box."},"changelog":"0.2.1 — Interne Zuverlässigkeits- und Robustheitsverbesserungen. / Internal reliability and robustness improvements. 0.2.0 — Over-the-air Updates (Kanäle stabil/experimentell) mit lokalem Update-Dashboard: Fortschrittsanzeige und robuster Neustart-Ablauf statt Fehlermeldung. / Over-the-air updates (stable/experimental channels) with a local update dashboard: progress UI and a robust restart flow instead of an error. 0.1.0 — Erste Version. / Initial release.","logsEnabled":true}'

# Local OTA/settings dashboard.
EXPOSE 8093

# The HCU completes installation once the container reports Docker healthy.
# Use 127.0.0.1 (not localhost) to avoid the IPv6/IPv4 mismatch. BusyBox wget
# in the base image supports --quiet --spider.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:8093/api/state || exit 1

# CMD (not a direct ENTRYPOINT) so the base image entrypoint wrapper runs it.
# The loader is the image-only entrypoint; it decides image vs OTA payload.
CMD ["node", "dist/bootstrap/loader.js"]
