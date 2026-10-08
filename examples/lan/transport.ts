/**
 * A transport of the vendor's own, for devices that speak a protocol the platform does not: JSON
 * over UDP on port 4003. An example, not part of the bundle until it is moved into `src/` (see
 * `examples/README.md`).
 *
 * The socket is the hub's (`sdk.openUdpSocket`): it binds it, and closes it when the vendor is
 * let go of, so the transport never leaves a port held. The transport owns what goes through it -
 * asking the lamp for its state as often as the driver's subscriptions say, delivering what the
 * lamp sends back, sending what a command becomes - and nothing about what it means: that is the
 * driver's.
 */
import {
  defineTransportModule,
  type TransportConnection,
  type TransportSubscription,
} from '@nebulahome/integration-sdk';

import { LAN_PORT, readPacket, writePacket } from './packet.js';

/** How long a Test waits for a lamp to answer. */
const PROBE_TIMEOUT_MS = 3000;

/** What reaching one lamp takes. */
type LanConfig = { readonly host: string };

export default defineTransportModule((sdk) =>
  sdk.defineTransport<LanConfig>({
    id: 'example/lan',
    configSchema: sdk.z.object({ host: sdk.z.string().min(1) }),

    /**
     * One connection per lamp: each has its own address.
     *
     * @param config - The lamp.
     * @returns Its address.
     */
    connectionKey: (config) => config.host,

    /**
     * Opens a socket to one lamp, and asks it for its state as often as the driver says.
     *
     * @param config - The lamp.
     * @param context - Where what the lamp sends goes.
     * @returns The connection.
     */
    connect: async (config, context) => {
      let poll: NodeJS.Timeout | undefined;
      const socket = sdk.openUdpSocket({
        /**
         * Delivers what the lamp sent, and nothing from anyone else.
         *
         * @param message - The datagram.
         * @param from - Who sent it.
         */
        onMessage: (message, from) => {
          const payload = readPacket(message);

          if (from.address === config.host && payload !== null) {
            context.deliver({ connectionKey: config.host, deviceKey: config.host, payload });
          }
        },
      });

      /**
       * Asks the lamp for its state.
       *
       * @returns Once asked; a failure is logged, the next poll asks again.
       */
      const askState = async (): Promise<void> =>
        socket
          .send(writePacket({ cmd: 'state' }), LAN_PORT, config.host)
          .catch((error: unknown) => {
            context.logger.debug({ err: error, host: config.host }, 'Could not ask a lamp');
          });

      context.report('up');

      const connection: TransportConnection = {
        key: config.host,

        /**
         * Sends a command: `{ "cmd": "set", "on": true }`.
         *
         * @param request - The driver's request.
         * @returns Nothing: the lamp's new state arrives as any other report.
         */
        send: async (request) => {
          await socket.send(
            writePacket({ cmd: request.op, ...request.args }),
            LAN_PORT,
            config.host,
          );
          await askState();

          return undefined;
        },

        /**
         * Polls the lamp at the interval the driver's subscriptions name.
         *
         * @param subscriptions - What the driver wants carried.
         * @returns Once applied.
         */
        apply: async (subscriptions: readonly TransportSubscription[]) => {
          clearInterval(poll);

          const every = subscriptions.find((subscription) => subscription.op === 'poll')?.args[
            'everyMs'
          ];

          if (typeof every === 'number') {
            poll = setInterval(() => void askState(), every);
            poll.unref();
            await askState();
          }
        },

        /**
         * Stops polling and closes the socket.
         *
         * @returns Once closed.
         */
        close: async () => {
          clearInterval(poll);
          await socket.close();
        },
      };

      return connection;
    },

    /**
     * Finds nothing by itself: the vendor's discovery module listens for the lamps.
     *
     * @yields Nothing.
     */
    async *scan() {
      // The discovery module (`discovery.ts`) is how lamps are found.
    },

    /**
     * Asks a lamp who it is, for the add form's Test.
     *
     * @param config - The lamp.
     * @param signal - Gives up.
     * @returns What the lamp said, in a sentence.
     * @throws {Error} When it does not answer in time.
     */
    probe: async (config, signal) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
      let socket: ReturnType<typeof sdk.openUdpSocket> | undefined;
      let giveUp: (() => void) | undefined;

      try {
        return await new Promise<string>((resolve, reject) => {
          giveUp = () => {
            reject(new Error(`Nothing answered on ${config.host}:${String(LAN_PORT)}`));
          };

          if (timeout.aborted) {
            giveUp();

            return;
          }

          timeout.addEventListener('abort', giveUp, { once: true });
          socket = sdk.openUdpSocket({
            /**
             * Takes the lamp's answer.
             *
             * @param message - The datagram.
             * @param from - Who sent it.
             */
            onMessage: (message, from) => {
              const info = readPacket(message);

              if (from.address === config.host && typeof info?.['name'] === 'string') {
                resolve(`${info['name']} answered`);
              }
            },
          });
          socket.send(writePacket({ cmd: 'info' }), LAN_PORT, config.host).catch(reject);
        });
      } finally {
        // Answered, refused or timed out: the socket and the listener go either way.
        if (giveUp !== undefined) {
          timeout.removeEventListener('abort', giveUp);
        }

        await socket?.close();
      }
    },
  }),
);
