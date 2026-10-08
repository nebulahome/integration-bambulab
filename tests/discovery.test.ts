/**
 * The Bambu Lab discovery module, fed the announcements printers make, word for word, through
 * the fake SDK's UDP sockets - no port is bound - and what the vendor's discovery makes of what
 * it reports: which driver, which printer.
 */
import { describe, expect, it } from 'vitest';

import type { Sighting } from '@nebulahome/integration-sdk';
import { createFakeSdk, identify, loadIntegration } from '@nebulahome/integration-sdk/testing';

import discovery, { announcementOf } from '../src/lan/discovery.js';

/** A vendor with nothing saved: what a listener that needs no settings is handed. */
const NO_SETTINGS = { settings: async (): Promise<Record<string, never>> => Promise.resolve({}) };

/** An announcement as a P1S makes it. */
const NOTIFY = [
  'NOTIFY * HTTP/1.1',
  'HOST: 239.255.255.250:1990',
  'Server: Buildroot/2018.02-rc3 UPnP/1.0 ssdpd/1.8',
  'Location: 192.168.1.60',
  'NT: urn:bambulab-com:device:3dprinter:1',
  'NTS: ssdp:alive',
  'USN: 01P00A123456789',
  'Cache-Control: max-age=1800',
  'DevModel.bambu.com: C12',
  'DevName.bambu.com: Workshop P1S',
  'DevConnect.bambu.com: lan',
  'DevBind.bambu.com: free',
  'DevVersion.bambu.com: 01.07.00.00',
  '',
  '',
].join('\r\n');

describe('finding printers', () => {
  it('reads what a printer says about itself', () => {
    expect(announcementOf(NOTIFY, '192.168.1.60')).toEqual({
      host: '192.168.1.60',
      serial: '01P00A123456789',
      model: 'C12',
      name: 'Workshop P1S',
      version: '01.07.00.00',
    });
  });

  it('ignores everybody else on the group', () => {
    const router = NOTIFY.replace('urn:bambulab-com:device:3dprinter:1', 'upnp:rootdevice').replace(
      'DevModel.bambu.com: C12\r\n',
      '',
    );

    expect(announcementOf(router, '192.168.1.1')).toBeUndefined();
    expect(announcementOf('M-SEARCH * HTTP/1.1\r\n\r\n', '192.168.1.2')).toBeUndefined();
  });

  it('reports a printer once however often it announces, with the broker it runs', async () => {
    const fake = createFakeSdk();
    const abort = new AbortController();
    const source = discovery(fake.sdk);
    const sightings: Sighting[] = [];
    const listening = (async () => {
      for await (const sighting of source.listen(abort.signal, NO_SETTINGS)) {
        sightings.push(sighting);
      }
    })();

    await Promise.resolve();

    const from = { address: '192.168.1.60', port: 1990 };

    for (const socket of fake.udpSockets) {
      socket.deliver(Buffer.from(NOTIFY), from);
    }

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    await listening;

    expect(fake.udpSockets.map((socket) => socket.port).sort()).toEqual([1990, 2021]);
    expect(sightings).toEqual([
      {
        config: { url: 'mqtts://192.168.1.60:8883' },
        payload: {
          serial: '01P00A123456789',
          host: '192.168.1.60',
          model: 'C12',
          name: 'Workshop P1S',
          version: '01.07.00.00',
        },
      },
    ]);
  });

  it('proposes the printer heard to the driver of its family, naming the model', async () => {
    const { vendor } = await loadIntegration();
    const payload = {
      serial: '01P00A123456789',
      host: '192.168.1.60',
      model: 'C12',
      name: 'Workshop P1S',
      version: '01.07.00.00',
    };

    expect(identify(vendor, { announcement: payload })).toMatchObject({
      matches: true,
      identity: {
        externalId: '01P00A123456789',
        name: 'Workshop P1S',
        modelCode: 'C12',
        swVersion: '01.07.00.00',
      },
      association: { driverId: 'printer-p1-a1', model: 'P1S' },
    });
  });

  it('knows every model code Bambu Studio names a printer by', async () => {
    const { vendor } = await loadIntegration();

    for (const driver of vendor.drivers) {
      for (const [code, model] of Object.entries(driver.manifest.modelCodes ?? {})) {
        expect(
          identify(vendor, { announcement: { serial: '01P00A123456789', model: code } })
            .association,
          code,
        ).toMatchObject({ driverId: driver.driverId, model });
      }
    }
  });
});
