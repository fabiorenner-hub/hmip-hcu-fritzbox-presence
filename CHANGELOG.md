# Changelog

All notable changes to this project are documented here.
Alle wesentlichen Änderungen an diesem Projekt sind hier dokumentiert.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/fabiorenner-hub/hmip-hcu-fritzbox-presence/releases/tag/0.1.0
