# Changelog

All notable changes to this project are documented here.
Alle wesentlichen Änderungen an diesem Projekt sind hier dokumentiert.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-07-14

### Added / Hinzugefügt

- Over-the-air (OTA) update system with **stable** and **experimental**
  channels; auto-update is on by default on the stable channel. /
  Over-the-air-(OTA-)Update-System mit den Kanälen **stabil** und
  **experimentell**; Auto-Update standardmäßig an auf dem stabilen Kanal.
- Local update dashboard (port 8093) with a progress bar and a robust install
  flow: the "Update now" button stays disabled through installing → restarting
  → done, tolerates the restart outage instead of showing "failed to fetch",
  and reloads automatically once the new version is up. /
  Lokales Update-Dashboard (Port 8093) mit Fortschrittsbalken und robustem
  Ablauf: „Jetzt aktualisieren" bleibt über Installieren → Neustart → Fertig
  gesperrt, verkraftet das Neustart-Fenster statt „failed to fetch" und lädt
  nach dem Hochkommen der neuen Version automatisch neu.
- Crash-loop protection in the boot loader with automatic rollback to the image
  bundle. / Crash-Loop-Schutz im Boot-Loader mit automatischem Rückfall auf das
  Image-Bundle.

## [0.1.0] - 2026-06-26

Initial release. / Erste Veröffentlichung.

### Added / Hinzugefügt

- One `OCCUPANCY_SENSOR` device per configured person; `PresenceDetected` is
  `true` while at least one of their devices is online on the FRITZ!Box. /
  Pro konfigurierter Person ein `OCCUPANCY_SENSOR`; `PresenceDetected` ist
  `true`, solange mindestens eines ihrer Geräte an der FRITZ!Box online ist.
- Device matching by network name or MAC address, optionally case-insensitive. /
  Geräteabgleich über Netzwerk-Namen oder MAC-Adresse, optional ohne
  Groß-/Kleinschreibung.
- Configurable arrival and departure delay to debounce flapping Wi-Fi. /
  Konfigurierbare Ankunfts- und Abgangsverzögerung gegen flatterndes WLAN.
- Optional `Maintenance` feature reporting `unreach` when the FRITZ!Box is
  unreachable. / Optionales `Maintenance`-Feature meldet `unreach`, wenn die
  FRITZ!Box nicht erreichbar ist.
- Robust `login_sid.lua` authentication (PBKDF2 with MD5 fallback) for
  Fritz!OS 7.57+. / Robuste `login_sid.lua`-Authentifizierung (PBKDF2 mit
  MD5-Fallback) für Fritz!OS 7.57+.
- Full HCUweb configuration (connection, presence tuning, advanced, about). /
  Vollständige HCUweb-Konfiguration (Verbindung, Anwesenheit, Erweitert, Über).

[0.2.0]: https://github.com/fabiorenner-hub/hmip-hcu-fritzbox-presence/releases/tag/v0.2.0
[0.1.0]: https://github.com/fabiorenner-hub/hmip-hcu-fritzbox-presence/releases/tag/0.1.0
