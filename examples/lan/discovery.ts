/**
 * A discovery module of the vendor's own: the lamps do not announce themselves over mDNS, they
 * answer a broadcast. It asks the network every minute - and when the owner presses "Discover
 * devices" (`scan`) - and reports each lamp that answers, with how to reach it. An example, not
 * part of the bundle until it is moved into `src/` (see `examples/README.md`).
 *
 * What a sighting carries is what the vendor's `discovery.json` reads: `match` and `identity`
 * paths into `payload`, and `config` - `{ host }` - becomes the device's connection once it is
 * added. Which driver it is, the hub decides from the model code, as for any vendor.
 */
import { defineDiscoveryModule, type Sighting } from '@nebulahome/integration-sdk';

import { LAN_PORT, readPacket, writePacket } from './packet.js';

/** How often the network is asked. */
const ASK_EVERY_MS = 60_000;

/** Where a broadcast goes. */
const BROADCAST = '255.255.255.255';

export default defineDiscoveryModule((sdk) => {
  /** Asks the network now; nothing before listening started. */
  let ask: () => void = () => undefined;

  return {
    /**
     * Listens until the signal ends it, reporting every lamp that answers.
     *
     * @param signal - Ends the listening.
     * @param context - Where the listener says how it is getting on.
     * @yields Each lamp heard; the same lamp again at each answer.
     */
    async *listen(signal, context) {
      const heard: Sighting[] = [];
      let wake: () => void = () => undefined;
      const socket = sdk.openUdpSocket({
        broadcast: true,

        /**
         * Keeps what a lamp answered.
         *
         * @param message - The datagram.
         * @param from - The lamp.
         */
        onMessage: (message, from) => {
          const payload = readPacket(message);

          if (payload?.['vendor'] === 'Example') {
            heard.push({ config: { host: from.address }, payload: payload as Sighting['payload'] });
            wake();
          }
        },
      });

      ask = () => {
        socket.send(writePacket({ cmd: 'scan' }), LAN_PORT, BROADCAST).catch((error: unknown) => {
          context.status?.({ level: 'error', message: `Cannot ask the network: ${String(error)}` });
        });
      };

      const timer = setInterval(ask, ASK_EVERY_MS);

      /** Ends the wait when the listening ends: one listener for as long as it listens. */
      const onAbort = (): void => {
        wake();
      };

      signal.addEventListener('abort', onAbort, { once: true });
      context.status?.({
        level: 'ok',
        message: `Asking the network on UDP ${String(LAN_PORT)} every minute`,
      });
      ask();

      try {
        while (!signal.aborted) {
          if (heard.length === 0) {
            // Until a lamp answers, or the listening ends: one wait per answer.
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }

          yield* heard.splice(0);
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        clearInterval(timer);
        ask = () => undefined;
        await socket.close();
      }
    },

    /** Asks the network again now. */
    scan: () => {
      ask();
    },
  };
});
