# Bambu Lab for NebulaHome

Bambu Lab 3D printers in **LAN mode** - every printer Bambu sells today, the A, H, P and X series -
read and controlled over the MQTT broker each printer runs itself: the chamber camera, the lights,
the nozzle, bed and chamber temperatures, the fans, the AMS and the print in progress, with pause,
resume and stop. Nothing leaves the house.

## How it works

- **Method**: MQTT on the device. A Bambu printer **is a broker**: it listens on port 8883, behind
  TLS with a certificate it signed itself, and NebulaHome connects to it with the platform's own
  `mqtt` transport. The camera is read over the LAN too: RTSP over TLS on port 322, or JPEG stills
  over TLS on port 6000, depending on the family.
- **Internet**: not needed.
- **Finding devices**: found automatically, by the SSDP announcements a printer in LAN mode makes
  every few seconds; a printer the router keeps off multicast, or on another subnet, is added by
  address.
- **Updates**: pushed by the printer - an X1 its whole status every second, a P1 or an A1 what
  changed - and a full status asked for every time the session comes up and every five minutes
  after.
- **Code**: no transport of its own. A discovery module, `src/lan/discovery.ts`, because the
  printers announce themselves over SSDP, which the platform's mDNS listener does not hear; and a
  camera stream source, `src/camera/stream.ts` (`bambulab/camera`), because a picture is frames
  over a connection of its own, not state - RTSPS through the platform's RTSP client, and Bambu's
  own still-camera protocol over TLS.

This vendor shipped inside the platform's hub as `bambu-lab` (version 1.2.0), the first bundle
there with a stream source. Here its id is `bambulab`, the name the Community Hub expects of a
repository called `integration-bambulab`: its drivers are `bambulab/printer` and the rest, and its
camera source `bambulab/camera`.

## Supported devices

Four drivers, one per set of entities the hardware fills. The series a printer is sold as does not
decide which - an X1C and an X2D differ in almost every entity, a P1S and a P2S in the camera, the
chamber and the door - so each driver says the series of each of its printers (`modelSeries`), and
the form adding one lists them by that: **A series** (A1, A1 mini, A2L), **H series** (H2C, H2D,
H2D Pro, H2S), **P series** (P1P, P1S, P2S), **X series** (X1, X1C, X1E, X2D). A printer's page
says its series too. The owner never sees the drivers.

The model codes are the ones Bambu's own software knows the printers by (`DevModel.bambu.com` in
the announcement), taken from Bambu Studio's printer definitions.

| Model   | Model code                       | Driver                | Method              | Status                                                     |
| ------- | -------------------------------- | --------------------- | ------------------- | ---------------------------------------------------------- |
| X1      | `3DPrinter-X1`, `BL-P002`        | `printer`             | MQTT on the printer | from other implementations                                 |
| X1C     | `3DPrinter-X1-Carbon`, `BL-P001` | `printer`             | MQTT on the printer | from other implementations                                 |
| X1E     | `C13`                            | `printer`             | MQTT on the printer | from other implementations                                 |
| P2S     | `N7`                             | `printer-p2s-h2s`     | MQTT on the printer | from other implementations                                 |
| H2S     | `O1S`                            | `printer-p2s-h2s`     | MQTT on the printer | from other implementations                                 |
| H2D     | `O1D`                            | `printer-dual-nozzle` | MQTT on the printer | from other implementations                                 |
| H2D Pro | `O1E`                            | `printer-dual-nozzle` | MQTT on the printer | from other implementations                                 |
| H2C     | `O1C`, `O1C2`                    | `printer-dual-nozzle` | MQTT on the printer | from other implementations                                 |
| X2D     | `N6`                             | `printer-dual-nozzle` | MQTT on the printer | from other implementations                                 |
| P1P     | `C11`                            | `printer-p1-a1`       | MQTT on the printer | from other implementations                                 |
| P1S     | `C12`                            | `printer-p1-a1`       | MQTT on the printer | verified on a device: connection, identification, readings |
| A1      | `N2S`                            | `printer-p1-a1`       | MQTT on the printer | from other implementations                                 |
| A1 mini | `N1`                             | `printer-p1-a1`       | MQTT on the printer | from other implementations                                 |
| A2L     | `N9`                             | `printer-p1-a1`       | MQTT on the printer | from other implementations                                 |

What was and was not tried on a printer is under
[Checked against hardware](#checked-against-hardware).

## What you get

- **X1 series printer** (`printer`) - X1, X1C, X1E. RTSP camera, one nozzle, the chamber sensor,
  the door read from `home_flag`, the SD card.
- **P2S and H2S printer** (`printer-p2s-h2s`) - P2S, H2S. RTSP camera, one nozzle, a heated
  chamber with its target, the door read from `stat`, both light bars.
- **Dual-nozzle printer** (`printer-dual-nozzle`) - H2D, H2D Pro, H2C, X2D. As above, with two
  nozzles instead of one.
- **P1, A1 and A2 series printer** (`printer-p1-a1`) - P1P, P1S, A1, A1 mini, A2L. The still
  camera, one nozzle, no chamber sensor (a P1 reports a number there that means nothing), the SD
  card.

### Every driver

The entities, and which driver has each: X1 is `printer`, P2S/H2S `printer-p2s-h2s`, Dual
`printer-dual-nozzle`, P1/A1 `printer-p1-a1`.

| Entity                                            | Domain          | What it does                                                                                                               | X1   | P2S/H2S | Dual | P1/A1  |
| ------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | ---- | ------ |
| Chamber light                                     | `light`         | on/off; `lights_report[0].mode`. On a P2S, an H2 or an X2D both light bars are switched                                    | yes  | yes     | yes  | yes    |
| Chamber camera                                    | `camera`        | the stream below; available while `ipcam.rtsp_url` is not `disable` (on a P1 or an A1, while `ipcam.ipcam_dev` is not `0`) | RTSP | RTSP    | RTSP | stills |
| Nozzle temperature / target                       | `sensor` °C     | `device.extruder.info[0].temp` packed, or `nozzle_temper` / `nozzle_target_temper`                                         | yes  | yes     | -    | yes    |
| Right / left nozzle temperature, and targets      | `sensor` °C     | `device.extruder.info[0]` (right) and `[1]` (left), packed                                                                 | -    | -       | yes  | -      |
| Nozzle diameter                                   | `sensor` mm     | `nozzle_diameter`                                                                                                          | yes  | yes     | -    | yes    |
| Bed temperature / target                          | `sensor` °C     | `device.bed.info.temp` packed, or `bed_temper` / `bed_target_temper`                                                       | yes  | yes     | yes  | yes    |
| Chamber temperature                               | `sensor` °C     | `chamber_temper`                                                                                                           | yes  | -       | -    | -      |
| Chamber temperature / target                      | `sensor` °C     | `device.ctc.info.temp` packed, or `chamber_temper`                                                                         | -    | yes     | yes  | -      |
| Printing                                          | `binary_sensor` | `gcode_state` is `RUNNING`                                                                                                 | yes  | yes     | yes  | yes    |
| Print status                                      | `sensor` text   | `gcode_state`, in words                                                                                                    | yes  | yes     | yes  | yes    |
| Stage                                             | `sensor` text   | `stg_cur`, in words - `-1` and `255` are both idle                                                                         | yes  | yes     | yes  | yes    |
| Print progress / remaining time                   | `sensor` % / s  | `mc_percent`, `mc_remaining_time` (minutes, registered in seconds)                                                         | yes  | yes     | yes  | yes    |
| Layer / total layers                              | `sensor`        | `layer_num`, `total_layer_num`                                                                                             | yes  | yes     | yes  | yes    |
| Speed level                                       | `sensor`        | `spd_lvl` - 1 silent, 2 standard, 3 sport, 4 ludicrous                                                                     | yes  | yes     | yes  | yes    |
| Print name / G-code file / source                 | `sensor` text   | `subtask_name`, `gcode_file`, `print_type`                                                                                 | yes  | yes     | yes  | yes    |
| Print error / health alerts                       | `binary_sensor` | `print_error` other than 0; `hms` not empty                                                                                | yes  | yes     | yes  | yes    |
| Fans: part cooling, auxiliary, chamber, heatbreak | `sensor` %      | `cooling_fan_speed`, `big_fan1_speed`, `big_fan2_speed`, `heatbreak_fan_speed`, in the tens of per cent the printer shows  | yes  | yes     | yes  | yes    |
| Wi-Fi signal                                      | `sensor` text   | `wifi_signal`, as the printer writes it (`-47dBm`)                                                                         | yes  | yes     | yes  | yes    |
| Timelapse                                         | `binary_sensor` | `ipcam.timelapse` is `enable`                                                                                              | yes  | yes     | yes  | yes    |
| LAN developer mode                                | `binary_sensor` | bit 29 of `fun` clear: the firmware takes unsigned commands                                                                | yes  | yes     | yes  | yes    |
| Door                                              | `binary_sensor` | bit 23 of `home_flag` (X1) or of `stat` (P2S, H2, X2D)                                                                     | yes  | yes     | yes  | -      |
| SD card                                           | `binary_sensor` | bit 8 of `home_flag` (X1, P1, A1)                                                                                          | yes  | -       | -    | yes    |
| AMS humidity / temperature                        | `sensor` % / °C | `ams.ams[0].humidity_raw`, `ams.ams[0].temp` - the first unit                                                              | yes  | yes     | yes  | yes    |
| Pause, Resume, Stop print, Refresh                | `button`        | `print.pause`, `print.resume`, `print.stop`, `pushing.pushall`                                                             | yes  | yes     | yes  | yes    |

**Packed readings.** Newer firmware - the H2s, the X2D, the P2S - reports a temperature as one
integer, the current value in the low 16 bits and the target in the high 16, and moves the bed and
chamber readings under `device`. The profile reads them with `bits` and tries the new place first
and the old one after, so a printer on either firmware fills the same entity. Right is extruder 0
and left extruder 1, as Bambu Studio numbers them.

**Commands need developer mode.** Firmware from the start of 2025 accepts a command over the LAN
only when it is signed with a key only Bambu's cloud has - unless **LAN only mode** and
**Developer mode** are both on in the printer's network settings. The _LAN developer mode_ sensor
says which the printer is in; with it off the readings and the camera still work, and the light
and the buttons are ignored by the printer. _Stop print_ asks before it is sent: a print stopped
cannot be resumed. The light has no toggle: the firmware has none, and a profile cannot compute
one, so it is switched on or off.

### The camera

Every printer has one, and every driver has the `camera.chamber_camera` entity; how the picture
arrives depends on the family, and `src/camera/stream.ts` reads both:

- **RTSP over TLS**, port 322, H.264: the X1s, the H2s, the P2S and the X2D. The printer serves it
  only with **LAN Mode Liveview** on (Settings → Network on the printer's screen); off, it reports
  `ipcam.rtsp_url` as `disable`, the entity says the camera is not streaming, and a stream asked
  for anyway fails saying to turn it on.
- **JPEG stills over TLS**, port 6000, about one a second: the P1s, the A1s and the A2L. An 80-byte
  greeting with the user `bblp` and the access code, then each picture behind a 16-byte header
  whose first bytes are its length. The card shows the latest still until play is pressed.

Both are reached at the host of the device's `mqtts://` address with the access code the broker
already takes, and behind a certificate the printer signed itself, checked against nothing for the
reason the broker's is not (below). The hub only relays the frames; the browser decodes them, so
nothing is transcoded and a stream runs only while somebody watches it.

### What a profile cannot say, and why

**Full reports and deltas.** An X1 pushes its whole status every second. A P1 or an A1 pushes only
what changed, and only after being asked once for everything - which is what the `pushall` in the
subscriptions is for. It is sent every time the session comes up and every five minutes after, so
a missed delta is a five-minute gap rather than a permanent one. Between those, a delta naming only
the nozzle changes only the nozzle: the mapper reads absence as absence, and a light that was not
mentioned stays exactly as it was. The answers to NebulaHome's own requests, which come back on the
same topic, are ignored rather than misread.

**The light is index zero.** `lights_report` is a list, and the profile grammar can index a list but
cannot search one. On every model this vendor names, `chamber_light` is the first entry - an X1
lists a `work_light` after it. If a printer ever lists them the other way round, the light here
will be the wrong one, and `[0]` in `profile.json` is the thing to change. The same holds for the
extruders and the AMS units, read by position.

## Adding a device

**On the printer first**: turn on **LAN mode** (LAN only mode) in its network settings, and note
the **access code** shown next to it - eight characters. For commands (the light, the buttons),
turn on **Developer mode** too; for the camera of an X1, an H2, a P2S or an X2D, turn on **LAN Mode
Liveview** (Settings → Network).

**What the printer is.** It publishes its state on `device/<serial>/report` and takes requests on
`device/<serial>/request`. The serial is the one on the box and on the printer's screen; the vendor
never needs to be told it, because it reads it off the topic the printer speaks on. The printer
lets in exactly one user:

| Setting  | Value                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| URL      | `mqtts://<printer address>:8883`                                                           |
| Username | `bblp`, always                                                                             |
| Password | the **access code** - eight characters, on the printer's screen under the network settings |

**The form.** One device per printer. A printer found on the network is offered on the vendor page
already as `mqtts://<address>:8883`, and the owner types only the access code. Otherwise
**Integrations → Bambu Lab → Add device** asks which model it is (listed by series), what to call
it, and the two things only the owner knows:

- **Printer address** - `mqtts://<the printer's IP>:8883`, like `mqtts://192.168.1.60:8883`; the IP
  is on the printer's screen under the network settings. It must be `mqtts://`: the printer has no
  plain-text listener, so `mqtt://<address>:1883` is refused by the printer with `ECONNREFUSED` -
  the host answered, nothing listens on that port - and the form refuses it first, saying why.
- **Access code** - the eight characters on the printer's screen next to LAN mode. It is sealed
  with `NEBULA_SECRETS_KEY` by the API and opened by the hub when the device starts; it is never
  served back.

**Test** opens one session to the printer before anything is saved, so a mistyped code is refused
with `Connection refused: Not authorized` rather than discovered later in a log. The other two
settings the broker needs come from `setup.json` as constants and never appear in the form, so the
row the hub reads is:

```json
{
  "url": "mqtts://192.168.1.60:8883",
  "username": "bblp",
  "password": { "$sealed": "v1:…" },
  "shouldVerifyCertificate": false
}
```

`shouldVerifyCertificate: false` is not optional, which is why it is a constant. The printer signs
its own certificate and is reached by address, so there is nothing the certificate could be checked
against; with it on, the handshake is refused and the device sits in `failed` with a message about
a self-signed certificate. What is given up is the guarantee that the thing at that address is the
printer; what is kept is that the traffic is encrypted. On a home network that is the right trade,
and the constant records that it was made.

**Identifying.** Once saved, the hub starts the device at once and it shows `identifying`: the hub
listens on `device/+/report` and claims whatever reports a `print` block, by the serial in its
topic, then asks `core` to complete the device's row with that serial and the printer's entities.
From then on the driver subscribes to that printer's report topic and asks it for a full status,
and the readings are on the device's row, changing as the printer reports. The claim stays on the
row, so a restarted hub watches the printer again on its own without listening for it twice.

**A P1 or an A1 can sit in `identifying` for a while.** Those printers report on change and when
asked, and the hub cannot ask before it knows the serial, which is the thing it is listening for.
Touching a setting on the printer's screen, or turning its light on, gives the hub something to
hear; the hub listens again as soon as a pass ends empty, so nothing has to be restarted. An X1
reports on its own every few seconds and is identified within them. The entity ids are composed
from the device's id (`sensor.bambu_lab_x1c_nozzle_temperature`), not from the serial, so a
replaced printer keeps its automations.

**Finding a printer.** A printer in LAN mode announces itself every few seconds over SSDP - to the
group 239.255.255.250 on port 1990, and as a broadcast on port 2021, where Bambu Studio listens -
and `src/lan/discovery.ts` listens on both; **look for devices** also sends an SSDP search, which
the printers that answer one answer at once. The announcement carries the printer's address, its
serial (`USN`), its model code (`DevModel.bambu.com`), the name its owner gave it and its firmware.

## Not supported yet

- **Setting things.** Target temperatures, fan speeds, the print speed and the AMS need
  capabilities for a number to set and a list to choose from, which the canonical model does not
  have yet.
- **Firmware updates.** Bambu's firmware is installed through its cloud, so there is no update
  entity.
- **More than the first AMS, and lights other than the first.** Lists are read by position: the
  first AMS unit, `lights_report[0]` (see above).

## Checked against hardware

There is no printer on the test bench. The vendor is tested against a simulated printer - it
answers `pushall` and `ledctrl` the way the firmware is documented to - and against the payloads
the community has recorded from real printers; the camera module against a fake still camera over
TLS and a fake RTSP client, discovery against the announcements printers make, word for word.

**The TLS handshake is settled.** `shouldVerifyCertificate: false` is passed straight through to
the client as `rejectUnauthorized: false`, and a real printer on a home network took the handshake
and answered the connect packet - `Not authorized` to a deliberately wrong code, which is the
broker speaking, past TLS. A certificate error from a device would therefore be news, and the
message will name what the client objected to.

**So is the identification.** The same printer, a P1S, answered the wildcard subscription the hub
listens on, `device/+/report`, within seconds of being asked, was identified from the interface
without a hand on it, and reported every entity above except the chamber temperature - which a P1S
does not have, as the entities table says. If a device stays `identifying` while a printer is on
and in LAN mode, the printer is idle and quiet: a P1 or an A1 reports on change, so touching a
setting on its screen, or turning its light on, gives the hub something to hear.

Nothing else here is claimed as tried on a printer: the other families and their packed readings,
the camera, discovery and the commands are written from the sources below and tested against fakes.

## Sources

Bambu Lab does not document the LAN protocol; what is here comes from:

- [Bambu Studio](https://github.com/bambulab/BambuStudio)'s printer definitions, by Bambu Lab
  (AGPL-3.0): the model codes a printer announces.
- [ha-bambulab](https://github.com/greghesp/ha-bambulab), the Home Assistant integration by Greg
  Hesp and contributors (MIT licence): read as the reference for the report's fields and the
  entities - the packed temperatures, stage and status in words, the print's name, file and
  source, errors and health alerts, fans, Wi-Fi, timelapse, developer mode, door, SD card, the AMS,
  the buttons, both light bars.
- The LAN-mode protocol as documented by the people who reverse-engineered it, and the payloads the
  community has recorded from real printers.

Bambu Lab and its logo are trademarks of Bambu Lab; this integration is not made or endorsed by it.

## Development

```bash
pnpm install
pnpm nebulahome-integration validate
pnpm typecheck
pnpm test
pnpm nebulahome-integration build
pnpm nebulahome-integration pack
```

The tests need no printer and no network: `tests/shipped.test.ts` loads the vendor as the hub loads
it and checks what every driver registers, `tests/printer.test.ts` drives each driver with what a
printer publishes, `tests/simulated-printer.test.ts` plays a P1 answering `pushall` and `ledctrl`,
`tests/camera.test.ts` serves the still camera from a TLS server on 127.0.0.1 (the certificate in
`tests/fixtures/` is a self-signed one for `127.0.0.1`, made for these tests), and
`tests/discovery.test.ts` feeds the listener the announcements printers make.

To try a build on a platform, copy `bambulab-<version>.tgz` into the platform's
`infra/local-integrations/`, then **Integrations → Install**. Releases: push the tag `v<version>`.
