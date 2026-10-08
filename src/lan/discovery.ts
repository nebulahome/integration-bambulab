/**
 * Finding Bambu Lab printers: the SSDP announcements they make on their own.
 *
 * A printer in LAN mode says it is there every few seconds, as an SSDP `NOTIFY` - to the group
 * 239.255.255.250 on port 1990, and as a broadcast to port 2021, where Bambu Studio listens. The
 * announcement carries what a candidate needs: the printer's address, its serial, the model code
 * Bambu's own software knows it by, the name its owner gave it and its firmware version:
 *
 * ```
 * NOTIFY * HTTP/1.1
 * Location: 192.168.1.60
 * NT: urn:bambulab-com:device:3dprinter:1
 * USN: 01P00A000000000
 * DevModel.bambu.com: C12
 * DevName.bambu.com: Workshop P1S
 * DevVersion.bambu.com: 01.07.00.00
 * ```
 *
 * Nothing is swept and nothing is asked that the printer is not already saying; the M-SEARCH sent
 * when the owner asks to look now is answered by the printers that answer one, and harmless to
 * those that wait for their next announcement. What the model code means is the drivers'
 * `modelCodes`, not this module's to decide.
 */
import { isIPv4 } from 'node:net';

import { defineDiscoveryModule, type Sighting, type UdpPeer } from '@nebulahome/integration-sdk';

/** Where printers announce themselves. */
const GROUP = '239.255.255.250';
const GROUP_PORT = 1990;
const BROADCAST_PORT = 2021;

/** What a printer calls the kind of device it is. */
const DEVICE_TYPE = 'urn:bambulab-com:device:3dprinter:1';

/** Where the printer's broker listens. */
const MQTT_PORT = 8883;

/** How often one printer is reported while it keeps announcing itself from the same address. */
const REPORT_EVERY_MS = 60_000;

/**
 * What a printer said about itself.
 */
type Announcement = {
  /** Its address. */
  host: string;
  /** Its serial. */
  serial: string;
  /** Bambu's code for its model. */
  model: string | undefined;
  /** What its owner called it. */
  name: string | undefined;
  /** Its firmware. */
  version: string | undefined;
};

/**
 * Reads an SSDP message, when it is a Bambu printer's.
 *
 * @param text - The datagram.
 * @param from - The address it came from.
 * @returns What the printer said, or nothing for anybody else's.
 */
export function announcementOf(text: string, from: string): Announcement | undefined {
  const [start, ...lines] = text.split(/\r?\n/u);

  if (start === undefined || !/^(?:NOTIFY \* HTTP\/1\.1|HTTP\/1\.1 200)/iu.test(start)) {
    return undefined;
  }

  const headers = new Map<string, string>();

  for (const line of lines) {
    const colon = line.indexOf(':');

    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }

  const type = headers.get('nt') ?? headers.get('st');
  const model = headers.get('devmodel.bambu.com');

  if (type !== DEVICE_TYPE && model === undefined) {
    return undefined;
  }

  // Some firmware writes the USN the way SSDP spells it, `uuid:<id>::<type>`.
  const serial =
    (headers.get('usn') ?? '')
      .replace(/^uuid:/iu, '')
      .split('::')[0]
      ?.trim() ?? '';
  const location = headers.get('location') ?? '';

  if (!/^[0-9A-Z]{6,32}$/iu.test(serial)) {
    return undefined;
  }

  return {
    host: isIPv4(location) ? location : from,
    serial,
    model: model === '' ? undefined : model,
    name: headers.get('devname.bambu.com') || undefined,
    version: headers.get('devversion.bambu.com') || undefined,
  };
}

/**
 * Makes the listener.
 *
 * @param sdk - What the hub hands a bundle.
 * @returns The listener.
 */
export default defineDiscoveryModule(function createBambuDiscovery(sdk) {
  let askNow: (() => void) | undefined;

  return {
    /**
     * Reports every printer that announces itself, until told to stop.
     *
     * @param signal - Ends the listening.
     * @yields Each printer, when first heard, when its address changed, and every minute while
     *   it keeps announcing itself.
     */
    listen: async function* listen(signal: AbortSignal) {
      const heard: Sighting[] = [];
      const reported = new Map<string, { readonly host: string; readonly atMs: number }>();
      let wake: (() => void) | undefined;

      /**
       * Takes one datagram.
       *
       * @param message - What arrived.
       * @param from - Who sent it.
       */
      const onMessage = (message: Buffer, from: UdpPeer): void => {
        const announcement = announcementOf(message.toString('utf8'), from.address);

        if (announcement === undefined) {
          return;
        }

        const nowMs = Date.now();
        const last = reported.get(announcement.serial);

        if (
          last !== undefined &&
          last.host === announcement.host &&
          nowMs - last.atMs < REPORT_EVERY_MS
        ) {
          return;
        }

        reported.set(announcement.serial, { host: announcement.host, atMs: nowMs });
        heard.push({
          config: { url: `mqtts://${announcement.host}:${String(MQTT_PORT)}` },
          payload: {
            serial: announcement.serial,
            host: announcement.host,
            ...(announcement.model === undefined ? {} : { model: announcement.model }),
            ...(announcement.name === undefined ? {} : { name: announcement.name }),
            ...(announcement.version === undefined ? {} : { version: announcement.version }),
          },
        });
        wake?.();
      };
      /**
       * Says why a socket could not listen; the other may still hear the printers.
       *
       * @param error - What failed.
       */
      const onError = (error: Error): void => {
        sdk.logger.debug({ err: error }, 'A Bambu Lab discovery socket failed');
      };
      const group = sdk.openUdpSocket({
        port: GROUP_PORT,
        reuseAddr: true,
        multicast: { group: GROUP },
        onMessage,
        onError,
      });
      const broadcast = sdk.openUdpSocket({
        port: BROADCAST_PORT,
        reuseAddr: true,
        broadcast: true,
        onMessage,
        onError,
      });

      /** Asks the printers that answer a search to say so now. */
      askNow = () => {
        const search = [
          'M-SEARCH * HTTP/1.1',
          `HOST: ${GROUP}:${String(GROUP_PORT)}`,
          'MAN: "ssdp:discover"',
          'MX: 3',
          `ST: ${DEVICE_TYPE}`,
          '',
          '',
        ].join('\r\n');

        reported.clear();
        group.send(search, GROUP_PORT, GROUP).catch((error: unknown) => {
          sdk.logger.debug({ err: error }, 'Could not send the Bambu Lab search');
        });
      };

      try {
        while (!signal.aborted) {
          const next = heard.shift();

          if (next !== undefined) {
            yield next;
            continue;
          }

          // One wait at a time, by design: the next announcement, or the end of listening.
          // eslint-disable-next-line no-await-in-loop -- see above
          await new Promise((resolve) => {
            /** Wakes the loop for the announcement that just arrived, or for the end. */
            wake = () => {
              resolve(undefined);
            };
            signal.addEventListener('abort', wake, { once: true });
          });
          wake = undefined;
        }
      } finally {
        askNow = undefined;
        await Promise.all([group.close(), broadcast.close()]);
      }
    },

    /**
     * Asks the printers again now, while listening; answers arrive through `listen`.
     */
    scan: () => {
      askNow?.();
    },
  };
});
