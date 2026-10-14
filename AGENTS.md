# Building a NebulaHome integration - instructions for agents

You are working in a repository started from `integration-template`. Its job is one **vendor**:
everything NebulaHome needs to find, add, read and control one brand's devices. Follow the steps
below in order; do not jump to writing files before the inventory and the research are done.

- `src/` **is** the vendor directory the hub loads: JSON files, a logo, and TypeScript only where
  a protocol needs code.
- `@nebulahome/integration-sdk` checks it with the hub's own loader (`validate`), builds it into
  `dist/<vendor>/` (`build`) and packs the release archive `<vendor>-<version>.tgz` (`pack`).
- Read more in `README.md` (this repository), `examples/README.md` (code of the vendor's own),
  `node_modules/@nebulahome/integration-sdk/README.md`, the schemas in
  `node_modules/@nebulahome/integration-sdk/schemas/` and the types in
  `node_modules/@nebulahome/integration-sdk/dist/index.d.ts`.

## What the SDK can do

Read this before designing: it is the whole surface, and what is not here does not exist yet.

**Finding devices** (`src/discovery.json`): listen to mDNS services, or ship a discovery module
(`defineDiscoveryModule`: `listen(signal, context)` and an on-demand `scan()`) for devices that
answer a broadcast; filter what is heard (`match`), ask the device (`probe`), read who it is
(`identity`) and propose it to the owner with the right driver and model. Without discovery,
devices are added by address.

**Reaching them** - a transport owns every connection:

- the platform's `http` (polling, any method, token in a header or the path, TLS with or without
  certificate checks) and `mqtt` (topics, publish, TLS, the house's broker through
  `sdk.platform.mqtt`);
- a transport of the vendor's own (`defineTransportModule` + `sdk.defineTransport`) for anything
  else - UDP (`sdk.openUdpSocket`), WebSocket kept open and reconnected (`sdk.openWebSocket`),
  MQTT sessions of its own (`sdk.openMqtt`), plain TCP or Modbus over `node:net`, a vendor
  cloud's API - with `connect`, `scan` and a `probe` the setup's **Test** button runs.

**Describing them** - a driver per family of models:

- **declarative** (`profile.json`): claim, identity, subscriptions, entities with the platform's
  capabilities, state paths and commands as requests - no code at all;
- **code** (`"kind": "code"`, `defineDriverModule`) when the entities depend on what the device
  says.

**Setting them up**: a form generated from `setup.json` - at the vendor level once (a cloud key)
and per device (address, credentials, options), with secrets sealed, constants hidden, and a
`polling` interval the owner can change per device. An **account** (`account.json` +
`defineAccountModule`) signs in to a vendor cloud in steps (a password, a code sent by mail) and
keeps the session the devices are reached through.

**More**: camera streams and snapshots (`streams` + `defineStreamModule`, `sdk.openRtsp`);
containers the vendor needs (`containers` in the manifest, e.g. a bridge to a radio) and platform
services it `requires` (`mqtt-broker`); firmware update entities; a link to the device's own web
page (`webPagePort`); LZMA and PNG helpers (`sdk.codecs`, `sdk.images`).

**Tools**: `validate`, `build`, `pack`; `@nebulahome/integration-sdk/testing` (`loadIntegration`,
`driverHarness`, `identify`, `createFakeSdk`) to test without a device; installing a build on a
platform from its local folder, with no restart.

## Fixed rules

- The repository is named `integration-<vendor>`; the Community Hub imports nothing else.
- **A folder's name is its id.** `src/manifest.json` says `"id": "<vendor>"`; `src/<driver>/`
  holds a `driver.json` that says `"id": "<driver>"`. An id starts with a lowercase letter,
  then lowercase letters, digits and `-`.
- Never write `version` or `sdk` in `src/manifest.json`: the build takes the version from
  `package.json` and the runtime range from the SDK. The version lives only in `package.json`.
- Keep the `$schema` line at the top of every JSON file: it is how you and the editor check it.
- Code is TypeScript in `src/`, named in the JSON by the `.js` the build writes
  (`"module": "./lan/transport.js"` for `src/lan/transport.ts`). Type each module with
  `defineTransportModule`, `defineDriverModule`, `defineDiscoveryModule`, `defineAccountModule`
  or `defineStreamModule` from `@nebulahome/integration-sdk`.
- In code, never import `zod` (use `sdk.z`) and never import from
  `@nebulahome/integration-sdk/testing`. Open UDP, WebSocket, MQTT and RTSP through the SDK
  (`sdk.openUdpSocket`, `sdk.openWebSocket`, `sdk.openMqtt`, `sdk.openRtsp`), so the hub frees
  them when the vendor is unloaded; a plain TCP connection (`node:net`) must be closed when its
  transport closes. Anything else a module imports must be a dependency in `package.json`: the
  build bundles it in.
- A transport of the vendor's own has the id `<vendor>/<name>`, and drivers name it so
  (`"transport": "example/lan"`).
- **Never invent ids.** Use only the values listed under [Closed lists](#closed-lists); anything
  else fails `validate` or registers a reading the interface cannot show.
- Do not ship what you only guessed: a model, a claim or a state path you could not confirm stays
  out, and the README says so. Do not ship battery devices that sleep (door sensors, H&T, flood
  sensors) unless the vendor has a listener that receives what they push when they wake.
- Never point a test at a real device or the network.
- **Events before polling, always.** When the device or the vendor offers a way to push changes -
  MQTT topics, a WebSocket or event stream, UDP notifications, webhooks, a long-poll that returns
  on change - use it, and do not poll. Poll only when nothing pushes, or for the values the
  pushed events never carry. A driver that polls a device able to push is wrong, even if it works.

## Workflow

Print one short status line when you finish each step.

### 1. Start from green

1. In `package.json` set `name` (`integration-<vendor>`), `version` (`0.1.0`) and `repository`
   (`github:<owner>/integration-<vendor>`).
2. `pnpm install`, then, before changing anything else, `pnpm nebulahome-integration validate`,
   `pnpm typecheck` and `pnpm test`. They pass on the untouched template; if they do not, stop and
   report it - the problem is the environment, not your vendor.

### 2. Device inventory

If you were given a complete device list, use it and fill only the gaps. Otherwise build this
table **before** writing files:

| Model | Model code | Driver id | How it is reached | How it is claimed | Entities (first release) | Confidence |
| ----- | ---------- | --------- | ----------------- | ----------------- | ------------------------ | ---------- |

- "How it is reached" is the method: local HTTP API, MQTT (device broker or the house's), the
  vendor's own UDP/TCP protocol, Modbus TCP, the vendor's cloud, or a bridge/gateway that carries
  Zigbee, BLE or Matter devices.
- Models that share protocol, payload shape and identity are **one driver** with a `models` list.
  A different layout of components, claim or payload is a new driver; a new generation with the
  same layout is more `models` on the same driver.
- Prefer the local way when the device has one; `internetRequired` comes from that fact.
- Among the ways a device is reached, prefer the one that pushes events over one that must be
  polled (see [Fixed rules](#fixed-rules)).
- Confidence is `verified` (official docs or a device you can reach), `ported` (read from another
  open-source implementation) or `guess`. Do not implement `guess` rows.
- A big brand ships a coherent first family - the models you were asked for, or the ones with a
  clear local API - and lists the rest as follow-ups.

Ask only when the brand itself is ambiguous (two companies, a product line that is not a vendor).

### 3. Research

For each family, in this order:

1. The vendor's own documentation: local API, MQTT topics, HTTP endpoints, authentication, TLS,
   identity fields, and above all whether the device pushes its changes (events, notifications,
   subscriptions) or can only be asked.
2. Similar open-source implementations - projects on GitHub, libraries that already speak the
   protocol. Their source is where request formats, payload layouts and model tables live. Before
   calling a device "cloud only", check whether someone already talks to it locally.
3. Other maintained projects in any language when the first ones are thin or contradict each other.

Write down, per family: transport and authentication (what is fixed, what the owner types),
whether it pushes events or must be polled, the claim field and its values, state paths, command
payloads, what you are deliberately leaving out. These notes become the README's sections; the
sources you read are not listed in the README. Research wins on protocol facts; the person who
asked wins on scope.

### 4. Choose the shape

| Situation | Do this |
| --- | --- |
| Same protocol and payload, the owner only picks a model | one driver with `models` |
| Different components, claim or payload | another driver folder |
| Entities not known until the device answers | `"kind": "code"` driver, not a profile pretending to be a program |
| A setting every device of the brand shares (one account, one key) | vendor `src/setup.json` |
| A setting of one device | the driver's `setup.json` |
| A value the owner must never change | `constants` in `setup.json` |
| A protocol the platform does not speak | a transport of the vendor's own: start from `examples/lan/` |
| Devices that answer a broadcast instead of announcing over mDNS | a discovery module: `examples/lan/discovery.ts` |

The platform's own transports are `http` and `mqtt`; everything else is code in this repository.

### 5. Write the vendor

**`src/manifest.json`** - `id`, `name`, `description` (one sentence an owner reads), `url` (the
vendor's official site), `color` (brand colour, `#RRGGBB`), `logo`, `internetRequired`; plus
`setup`, `transports` and `requires` when they apply.

**Logo** - SVG (or PNG), at most 64 KiB. When available, always prefer the company's official
logo or mark (an SVG from the vendor's site, brand page or press kit); draw a simple monogram in
the vendor colour only when no official logo can be found. `{ "path": "./logo.svg", "padding": 2 }`
when the mark touches the edge.

**`src/discovery.json`** (optional; without it devices are only added by hand - say so in the
README):

- `listen`: up to 4 sources, `{ "mdns": "_name._tcp" }` or `{ "module": "./lan/discovery.js" }`.
- `match`: all-of conditions on the announcement (`service`, `instance`, `host`, `address`,
  `port`, `txt.<key>`) with `equals`, `exists`, `oneOf`, `startsWith`. A noisy service such as
  `_http._tcp` needs a match, or every printer on the network gets probed.
- `probe` (optional): the cheapest request that works on every model without credentials.
- `identity`: where the answer says `externalId`, `name`, `model`, `swVersion`; each a path or a
  list of paths tried in order. `model` is looked up in the drivers' `modelCodes`, so every model
  you add is in a claim **and** in `modelCodes`.

**Each `src/<driver>/`**:

- `driver.json` - `id`, `name`, `transport`, `models`, `modelCodes`, `defaultIcon`, `kind`
  (`declarative` with `profile`, or `code` with its module in `entry`), `setup`; `webPagePort`
  (and `webPagePath`) when the device serves its own web page.
- `setup.json` - `transport` (the transport's config) and `options`, each with `constants` (never
  shown) and `fields` (the form, in order). Field `key`s are camelCase keys the transport already
  understands. Types: `text` (`pattern` + `patternMessage`, `placeholder`), `secret` (credentials;
  never served back), `number` (`min`, `max`, `isInteger`, `unit`, `warnBelow` + `warning`),
  `boolean`, `choice` (`choices: [{ value, label }]`), `list`.
  - `http` reads `host` (`host` or `host:port`), `isSecure`, `shouldVerifyCertificate`,
    `timeoutMs`, `username`, `password`, `token`, `tokenHeader`, `tokenPrefix`, `pathPrefix`.
  - `mqtt` reads `url` (`mqtt://host:1883` or `mqtts://`), `username`, `password`,
    `shouldVerifyCertificate`.
- `profile.json` - `discovery` (`probe`, `claim`, `identity`), `subscriptions`, `entities`.
  - Claim conditions are all-of; `oneOf` lists values of **one** path.
  - `http`: requests `{ "op": "get", "args": { "path", "query", "body" } }`, with `op` one of
    `get`, `post`, `put`, `patch`, `delete`; reading on a timer is the subscription
    `{ "op": "poll", "args": { "path", "everyMs" } }`.
  - `mqtt`: subscriptions `{ "op": "topic", "args": { "filter" } }`; requests
    `{ "op": "publish", "args": { "topic", "payload", "retain" } }`.
  - A path that is not a bare identifier is quoted: `"'switch:0'.output"`. A value taken from
    the command or the device is `{ "$": "command.level" }`.
  - Every entity has an `icon`; a numeric sensor has `unitOfMeasurement`, and `deviceClass` and
    `stateClass` when they apply.
  - A firmware update the API can report is an `update` entity (capability
    `"update": { "canInstall": true, "hasProgress": true }` as far as the API goes, state
    `installedVersion`, `latestVersion`, `isInstalling`, `progress`; command `update.install` when
    the API can install it). Say in the README when the API cannot.

**Polling** is the last resort: use it only when the device pushes nothing (see
[Fixed rules](#fixed-rules)). A driver whose profile has a `poll` subscription declares, in its
`setup.json`, `"polling": { "default": 10, "min": 2, "warnBelow": 5 }` in **seconds**. The owner's choice
replaces every `everyMs` of the profile, so `default × 1000` equals the profile's `everyMs`. A
driver with no `poll` has no `polling`, and nobody declares a field called `pollInterval`. Take
the numbers from the device: how often its own app or other implementations poll it, and where it
starts to misbehave.

**Code.** To ship a transport or a discovery module, move `examples/lan/` into `src/` (and
`examples/lan.test.ts` into `tests/`, fixing its imports) and name it as `examples/README.md`
shows. Delete what you do not use: `src/lamp/`, and `examples/` with
its test if the vendor needs no code.

### 6. Tests

Rewrite `tests/example.test.ts` for the vendor (rename it `tests/<vendor>.test.ts`), with
`@nebulahome/integration-sdk/testing`:

- `loadIntegration()` - the vendor loaded as the hub loads it; assert `failures` is empty and the
  drivers are the ones you wrote.
- `driverHarness(integration.driver('<driver>'), { options: { pollInterval: 10 } })` - per driver:
  `claim` refuses a foreign device and `add` accepts each model (with a payload copied from the
  documentation), `receive` maps a real payload to state, `command` builds the right request,
  `subscriptions` polls at the owner's interval.
- `identify(vendor, { announcement, probed })` - discovery proposes the right driver and model.
- A transport of the vendor's own: `createFakeSdk()` gives fake UDP sockets you `deliver` to and
  read `sent` from (see `examples/lan.test.ts`), and fake WebSockets (`webSockets`) you
  `open`, `deliver` to and `drop` - with `{ status: 401 }` for credentials the
  server refuses - reading their `headers` and `sent`; pass other SDK pieces as `overrides`.

### 7. Gates

All of these exit 0 before you say the work is done:

```bash
pnpm nebulahome-integration validate
pnpm typecheck
pnpm test
pnpm nebulahome-integration build
pnpm nebulahome-integration pack
```

`pnpm pack` is pnpm's own command and not this one. Fix the vendor, never the check.

### 8. README

Replace `README.md` - it describes the template - with the vendor's, written on the model at the
end of this file. Keep it true: what is not confirmed on a real device is marked so.

### 9. Release (only when asked)

Raise `version` in `package.json`, commit, push the tag `v<version>`;
`.github/workflows/release.yml` does the rest.

### When you finish

A short summary, a few lines: what the vendor ships, what was left out and why, and what has not
been tried on a real device.

## Closed lists

| Field | Values |
| --- | --- |
| entity `domain` | `light`, `switch`, `sensor`, `binary_sensor`, `cover`, `lock`, `climate`, `media_player`, `camera`, `button`, `update`, `lawn_mower`, `select`, `number`, `vacuum`, `image`, `custom` |
| `stateClass` | `measurement`, `total`, `total_increasing` |
| `icon` / `defaultIcon` | `light`, `lamp`, `switch`, `relay`, `plug`, `power`, `energy`, `printer`, `sensor`, `thermometer`, `thermostat`, `humidity`, `fan`, `heater`, `air-conditioner`, `camera`, `speaker`, `tv`, `lock`, `door`, `window`, `blind`, `garage`, `router`, `motion`, `smoke`, `water`, `battery`, `solar`, `car`, `washing-machine`, `refrigerator`, `oven`, `vacuum`, `lawn-mower`, `sprinkler`, `remote`, `device`; any lucide icon name is an id too |

Capabilities, with the state fields a profile maps and the commands it answers (the full schemas
are in `dist/index.d.ts`):

| Capability | State fields | Commands |
| --- | --- | --- |
| `on_off` | `isOn` | `turn_on`, `turn_off`, `toggle` |
| `level` | `level` | `set_level` |
| `color_hs` | `hue`, `saturation` | `set_color` |
| `color_temp` | `mireds` | `set_color_temp` |
| `cover` | `position`, `tilt`, `motion` | `open`, `close`, `stop`, `set_position`, `set_tilt` |
| `lock` | `lockState` | `lock`, `unlock` |
| `thermostat` | `currentTemperature`, `targetTemperature`, `mode`, `action`, `humidity` | `set_target`, `set_mode` |
| `sensor_numeric` | `value` | - |
| `sensor_binary` | `isOn` | - |
| `sensor_text` | `value` | - |
| `media_player` | `playback`, `volume`, `isMuted`, `source`, `mediaTitle`, `mediaArtist`, `mediaDurationSeconds`, `mediaPositionSeconds` | `play`, `pause`, `stop`, `next`, `previous`, `seek`, `set_volume`, `set_mute`, `set_source` |
| `camera` | `isStreamAvailable`, `snapshotPath`, `isRecording` | `snapshot`, `record` |
| `button` | - | `press` |
| `update` | `installedVersion`, `latestVersion`, `isInstalling`, `progress` | `install` |
| `lawn_mower` | `activity`, `isResumable` | `start`, `pause`, `stop`, `dock`, `resume` |
| `select` | `option` | `select_option` |
| `number` | `value` | `set_value` |
| `vacuum` | `activity`, `rooms`, `isResumable` | `start`, `pause`, `stop`, `dock`, `locate`, `resume`, `clean_rooms` |

`image` and `custom` exist too, for what fits nothing above; read their schemas before using them.

Pair them as `light` + `on_off` (+ `level`, `color_hs`, `color_temp`), `switch` + `on_off`,
`sensor` + `sensor_numeric` or `sensor_text`, `binary_sensor` + `sensor_binary`. A command key in
a profile is `<capability>.<command>`: `on_off.turn_on`.

Numeric sensor classes (`deviceClass`) and the units (`unitOfMeasurement`) each takes - the most
used; omit `deviceClass` for a number without a class (a progress, a count) and keep the unit:

| `deviceClass` | Units |
| --- | --- |
| `power` | `W`, `kW` |
| `energy` | `Wh`, `kWh` (`total_increasing` by default) |
| `voltage` | `V`, `mV` |
| `current` | `A`, `mA` |
| `frequency` | `Hz` |
| `power_factor` | `%` |
| `temperature` | `°C`, `°F` |
| `humidity` | `%` |
| `battery` | `%` |
| `illuminance` | `lx` |
| `pressure` | `hPa`, `bar` |
| `carbon_dioxide` | `ppm` |
| `pm25`, `pm10` | `µg/m³` |
| `signal_strength` | `dBm` |
| `duration` | `s`, `min`, `h` |
| `water`, `gas` | `L`, `m³` |

A `binary_sensor`'s `deviceClass` says what On means: `motion`, `occupancy`, `presence`, `door`,
`window`, `opening`, `garage_door`, `running`, `connectivity`, `battery`, `battery_charging`,
`moisture`, `smoke`, `gas`, `problem`, `plug`, `power`.

## The vendor's README

Write `README.md` on this model. Every section is required; write "None" rather than dropping
one.

~~~markdown
# <Vendor> for NebulaHome

<One sentence: which brand, which devices, and what an owner can do with them.>

## How it works

- **Method**: <how NebulaHome talks to the devices: local HTTP API / MQTT on the device /
  MQTT on the house's broker / the vendor's own UDP or TCP protocol / Modbus TCP / the vendor's
  cloud / a bridge that carries Zigbee, BLE or Matter devices - and which one, if several.>
- **Internet**: <not needed / needed, and for what.>
- **Finding devices**: <found automatically over mDNS or a broadcast / added by address.>
- **Updates**: <pushed by the device / read every N seconds by default, changeable per device.>
- **Code**: <none, declarative only / a transport or discovery module of its own, and why the
  platform's could not do it.>

## Supported devices

| Model | Model code | Driver | Method | Status |
| ----- | ---------- | ------ | ------ | ------ |
| <Desk Lamp> | <EL-D1> | <lamp> | <local HTTP> | <verified on a device / from the docs / from another implementation> |

## What you get

### <Driver name>

| Entity | Domain | What it does |
| ------ | ------ | ------------ |
| <Light> | `light` | <on/off, brightness> |

<What the device can do that is not exposed yet.>

## Adding a device

<What to do on the device first (enable LAN mode, local MQTT, an API key...), then what the form
asks: each field, and where the owner finds the value.>

## Not supported yet

<Models and features left out, and why: cloud-only, sleeping battery devices, firmware too old,
no way to confirm a payload. "None" if nothing.>

## Development

```bash
pnpm install
pnpm nebulahome-integration validate
pnpm typecheck
pnpm test
pnpm nebulahome-integration build
pnpm nebulahome-integration pack
```

<How to try it on a platform: the `.tgz` in the platform's `infra/local-integrations/`, then
**Integrations → Install**. Releases: push the tag `v<version>`.>
~~~
