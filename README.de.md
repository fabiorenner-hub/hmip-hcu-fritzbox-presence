# HMIP HCU Plugin: FRITZ!Box Anwesenheit

[English version → `README.md`](README.md)

Ein Plugin für die [Homematic IP](https://www.homematic-ip.com/) Home Control
Unit (HCU), das anzeigt, **wer zuhause ist**. Es fragt deine
[FRITZ!Box](https://avm.de/) nach den aktuell online befindlichen
Netzwerkgeräten ab, ordnet diese Personen zu und stellt jede Person als
`OCCUPANCY_SENSOR`-Gerät in der Homematic IP App bereit — direkt nutzbar in
Automatisierungen, Szenen und Gruppen.

`pluginId: de.fr.renner.plugin.fritzboxpresence`

Inspiriert von
[timo-reymann/fritzbox-based-presence](https://github.com/timo-reymann/fritzbox-based-presence).
Strikt anhand der offiziellen Connect-API-Dokumentation 1.0.1 umgesetzt —
Gerätetypen, Feature-Schemata und Enum-Werte stammen wörtlich aus der Spec,
nichts ist geraten.

> Hinweis: persönliches, selbst gehostetes Hobby-Projekt, kein offizielles
> eQ-3- oder AVM-Produkt. Nutzung auf eigene Gefahr.

## Support

Fehler gefunden oder Frage? Bitte ein [Issue öffnen](../../issues). Bitte
HCU-Firmware-Version, Plugin-Version, Fritz!OS-Version und die relevanten Zeilen
aus dem Connect-Protokoll (HCUweb → Plugin-Log) angeben.

## Updates (over-the-air)

Das Plugin kann sich over-the-air aktualisieren. Ein kleines lokales Dashboard
unter `http://<deine-hcu>.local:8093/` (dunkles Theme, DE/EN) zeigt die
installierte / Image- / neueste Version und lässt dich **Kanal** und **Modus**
wählen:

- **stabil** (Standard) — geprüfte GitHub-Releases.
- **experimentell** — rollierende Vorabversionen, over-the-air ausgeliefert ohne
  neuen `.tar.gz`/HCUweb-Upload. Für Tester.
- Modus **manuell** (Standard) prüft im Hintergrund und lässt dich bei Bedarf
  installieren; **automatisch** installiert neue Versionen auf dem gewählten
  Kanal selbsttätig.

Der **„Jetzt aktualisieren"**-Button zeigt einen Fortschrittsbalken und einen
robusten Ablauf (Installieren → Neustart → Fertig), der das Neustart-Fenster
übersteht und automatisch neu lädt — kein „failed to fetch" mehr.

Das Plugin startet über einen kleinen Bootstrap-Loader, der entweder das
mitgelieferte Image oder ein installiertes OTA-Payload ausführt, mit
**Crash-Loop-Schutz**: Startet ein OTA-Payload dreimal nicht, wird es in
Quarantäne verschoben und das Plugin fällt automatisch auf das Image zurück. Ein
stabiles Core-Image gewinnt immer gegen ein älteres OTA-Payload. Größere
Upgrades, die einen neueren Core brauchen, kommen weiterhin als `.tar.gz` über
HCUweb.

## Was es kann

- **Anwesenheit pro Person.** Jede konfigurierte Person wird ein
  `OCCUPANCY_SENSOR`-Gerät. `PresenceDetected` ist `true`, solange mindestens
  eines ihrer Geräte an der FRITZ!Box online ist, sonst `false`.
- **Abgleich nach Name oder MAC.** Personen werden über den Netzwerk-Namen oder
  die MAC-Adresse zugeordnet, optional ohne Groß-/Kleinschreibung.
- **Ankunfts-/Abgangsverzögerung.** Entprellt flatterndes WLAN: ein Gerät muss
  erst eine einstellbare Zeit online sein (bzw. alle offline), bevor umgeschaltet
  wird — glättet Powersave-Aussetzer von Smartphones.
- **Erreichbarkeit.** Optionales `Maintenance`-Feature meldet `unreach`, wenn die
  FRITZ!Box nicht erreichbar ist; der Plugin-Status wechselt entsprechend auf
  `ERROR`.
- **Live-Aktualisierung.** Ein `STATUS_EVENT` wird nur gesendet, wenn ein Poll
  eine echte Anwesenheitsänderung erkennt (Anwesenheit ist read-only — es gibt
  keinen Steuerbefehl).
- **Robuster Login.** Standard-`login_sid.lua`-Challenge-Response mit PBKDF2 und
  MD5-Fallback, deckt Fritz!OS 7.57+ ab.

## Auf der HCU installieren

1. Die aktuelle `fritzbox-presence-<version>-arm64.tar.gz` von der
   [Releases](../../releases)-Seite laden (oder selbst bauen, siehe unten).
2. In **HCUweb → Plugins** die `.tar.gz` hochladen.
3. Die Konfigurationsseite des Plugins öffnen und FRITZ!Box-**URL**,
   **Benutzername** und **Passwort** sowie das **Geräte-Mapping** setzen.

Das Image muss `arm64` sein (die CPU der HCU) und als `.tar.gz` hochgeladen
werden.

### FRITZ!Box-Benutzer anlegen

Einen eigenen FRITZ!Box-Benutzer anlegen (System → FRITZ!Box-Benutzer), der das
Heimnetz sehen darf, und diese Zugangsdaten im Plugin hinterlegen.

## Selbst bauen

Voraussetzungen: Node.js ≥ 20 und Docker (mit `buildx` für arm64).

```bash
npm install          # Toolchain installieren
npm run build        # tsc → dist/
docker buildx build --platform=linux/arm64 -t fritzbox-presence:0.1.0 .
docker save fritzbox-presence:0.1.0 | gzip > fritzbox-presence-0.1.0-arm64.tar.gz
```

Anschließend die `.tar.gz` über HCUweb hochladen.

Für die lokale Entwicklung gegen einen freigegebenen HCU-WebSocket:

```bash
node dist/index.js <plugin-id> <hcu-host> <authtoken-datei>
```

## Konfiguration

Alle Einstellungen sind auf der Konfigurationsseite des Plugins in HCUweb
editierbar, gruppiert in vier Bereiche.

**FRITZ!Box**

| Einstellung | Typ | Pflicht | Hinweise |
|---|---|---|---|
| FRITZ!Box-URL | string | ja | z. B. `http://192.168.178.1` |
| Benutzername | string | ja | FRITZ!Box-Benutzer mit Heimnetz-Berechtigung |
| Passwort | password | ja | wird nie zurückgegeben; Platzhalter `********` behält es |
| TLS-Zertifikate ignorieren | boolean | nein | nur für `https://` mit selbstsigniertem Zertifikat |
| Request-Timeout (Sekunden) | integer | nein | HTTP-Timeout, 1–120, Standard 10 |

**Anwesenheit**

| Einstellung | Typ | Pflicht | Hinweise |
|---|---|---|---|
| Geräte-Mapping | string | ja | `Person=id1,id2\|Person2=id3` |
| Abgleich über | string | nein | `name` oder `mac` (Standard `name`) |
| Ohne Groß-/Kleinschreibung | boolean | nein | Schreibweise beim Abgleich ignorieren |
| Poll-Intervall (Sekunden) | integer | nein | 5–3600, Standard 30 |
| Ankunftsverzögerung (Sekunden) | integer | nein | so lange online, bevor „anwesend" (0 = sofort) |
| Abgangsverzögerung (Sekunden) | integer | nein | so lange offline, bevor „abwesend" |

**Erweitert**

| Einstellung | Typ | Pflicht | Hinweise |
|---|---|---|---|
| Erreichbarkeit melden | boolean | nein | `Maintenance`-Feature mitsenden, Standard an |
| Geräte-Modellname | string | nein | gemeldeter Modellname der Geräte |
| Log-Level | string | nein | `error`, `warn`, `info`, `debug` (Standard `info`) |

**Über** — schreibgeschützte Versionsinfo und ein Doku-Link.

> Auswahlfelder (`Abgleich über`, `Log-Level`) nutzen `STRING` mit dokumentiertem
> Wertemuster statt `ENUM`, das in aktuellen HCUweb-Builds als leeres Dropdown
> dargestellt wird.

Die Konfiguration wird unter `CONFIG_PATH` gespeichert (Standard bei Installation
`/data/config.json`).

## Abbildung auf die Connect API

- **Gerätetyp**: `OCCUPANCY_SENSOR` (Spec §6.6.5)
- **`PresenceDetected`** (§6.7.23, Pflicht) — `true` = zuhause, `false` = weg
- **`Maintenance`** (§6.7.16, optional) — `unreach = true`, wenn die FRITZ!Box
  nicht erreichbar ist
- Lebenszyklus über `PluginStateResponse` / `PluginReadinessStatus` (§6.6.9:
  `CONFIG_REQUIRED` · `ERROR` · `READY`), Gerätesync über `DISCOVER_RESPONSE` /
  `STATUS_RESPONSE`, Live-Änderungen über `STATUS_EVENT`.

## Fehlersuche

- **Status bleibt `CONFIG_REQUIRED`** → URL, Benutzername, Passwort oder Mapping
  fehlt.
- **Status `ERROR`** → FRITZ!Box-Login oder -Verbindung fehlgeschlagen; URL und
  Zugangsdaten sowie das Plugin-Log prüfen.
- **Eine Person wird nie als anwesend erkannt** → der konfigurierte Name bzw. die
  MAC muss exakt dem entsprechen, was die FRITZ!Box unter Heimnetz anzeigt;
  `Abgleich über = mac` oder die Schreibweise-unabhängige Option versuchen.
- **Anwesenheit flattert** → Abgangsverzögerung erhöhen (Smartphones trennen das
  WLAN zum Stromsparen).
- **Connect-Protokoll zeigt `ERROR_RESPONSE` / Deserialisierungsfehler** → ein
  Feature- oder Enum-Wert wurde von der HCU abgelehnt; prüfen, ob die
  Plugin-Version aktuell ist.

## Autor

Fabio Renner ([@fabiorenner-hub](https://github.com/fabiorenner-hub)).

### Drittkomponenten

- [ws](https://github.com/websockets/ws) — WebSocket-Client (MIT).
- [uuid](https://github.com/uuidjs/uuid) — Nachrichten-IDs (MIT).
- Inspiriert von [fritzbox-based-presence](https://github.com/timo-reymann/fritzbox-based-presence) (Apache-2.0).

## Lizenz

[Apache License 2.0](LICENSE).
