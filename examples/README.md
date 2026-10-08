# Examples

Code a vendor may need, kept out of the bundle so the template stays a vendor that works with no
code at all. Each is type-checked and tested with the rest (`examples/lan.test.ts`).

## `lan/` - a protocol the platform does not speak

Lamps that talk JSON over UDP on port 4003 and answer a broadcast instead of announcing themselves
over mDNS:

- `lan/transport.ts` - a **transport** of the vendor's own: one socket per lamp, polling it as
  often as the driver says, delivering what it sends, sending what a command becomes. The socket
  is the hub's (`sdk.openUdpSocket`), so the vendor never leaves a port held.
- `lan/discovery.ts` - a **discovery module**: asks the network every minute and when the owner
  presses _Discover devices_, and reports each lamp that answers.
- `lan/packet.ts` - the protocol, shared by both; the build puts it in one chunk.

To use them, move `lan/` into `src/` and name them in the bundle:

```jsonc
// src/manifest.json
"transports": { "lan": { "module": "./lan/transport.js", "wires": ["udp"] } }

// src/discovery.json
"listen": [{ "module": "./lan/discovery.js" }]

// src/<driver>/driver.json
"transport": "example/lan"
```

The bundle names each module by what the build writes (`.js`); the source is the `.ts` beside it.
A driver on the vendor's own transport is still declarative: its `profile.json` maps what
`deliver` hands it and builds the requests `send` gets (`{ "op": "set", "args": { "on": true } }`).
`setup.json`'s transport fields are the transport's `configSchema` - here `host`.

Code runs inside the hub, so it is reviewed before the Community Hub marks a vendor official; keep
it to what the protocol needs, and never import zod (use `sdk.z`) or open a socket of your own
(use the SDK's).
