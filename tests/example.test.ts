/**
 * The example vendor, loaded and driven the way the hub loads and drives it: what adding a lamp
 * does, what its state becomes, what a command becomes, and what discovery makes of a lamp that
 * announces itself. No lamp and no network: a declarative driver is pure, so this is all of it.
 */
import { describe, expect, it } from 'vitest';

import { driverHarness, identify, loadIntegration } from '@nebulahome/integration-sdk/testing';

/** What a lamp answers to `GET /info`: what the probe reads. */
const INFO = { vendor: 'Example', id: 'el-0042', name: 'Desk', model: 'EL-D1', firmware: '2.1.0' };

describe('the example vendor', () => {
  it('loads as the hub loads it', async () => {
    const integration = await loadIntegration();

    expect(integration.failures).toEqual([]);
    expect(integration.vendor.drivers.map((driver) => driver.driverId)).toEqual(['lamp']);
    expect(integration.vendor.wires).toEqual(['http']);
  });

  it('claims a lamp by what it says of itself, and describes one light', async () => {
    const lamp = driverHarness((await loadIntegration()).driver('lamp'), {
      options: { pollInterval: 10 },
      deviceId: 'desk',
    });

    const added = lamp.add({ deviceKey: '192.168.1.60', payload: INFO });

    expect(lamp.claim({ deviceKey: '192.168.1.61', payload: { vendor: 'Other' } })).toBeNull();
    expect(added.device).toMatchObject({ externalId: 'el-0042', name: 'Desk', model: 'EL-D1' });
    expect(added.entityIds).toEqual(['light.desk']);
  });

  it('reads its state, and turns commands into requests', async () => {
    const lamp = driverHarness((await loadIntegration()).driver('lamp'), {
      options: { pollInterval: 10 },
      deviceId: 'desk',
    });

    lamp.add({ deviceKey: '192.168.1.60', payload: INFO });

    expect(lamp.receive({ on: true, brightness: 40 })).toEqual([
      expect.objectContaining({
        entityId: 'light.desk',
        state: { on_off: { isOn: true }, level: { level: 40 } },
      }),
    ]);
    expect(lamp.command('light.desk', 'level', { command: 'set_level', level: 75 })).toEqual({
      deviceKey: '192.168.1.60',
      op: 'post',
      args: { path: '/state', body: { brightness: 75 } },
    });
  });

  it('polls as often as the owner chose', async () => {
    const lamp = driverHarness((await loadIntegration()).driver('lamp'), {
      options: { pollInterval: 30 },
    });

    lamp.add({ deviceKey: '192.168.1.60', payload: INFO });

    expect(lamp.subscriptions()).toEqual([
      { op: 'poll', args: { deviceKey: '192.168.1.60', path: '/state', everyMs: 30_000 } },
    ]);
  });

  it('proposes a lamp that announces itself, naming its model', async () => {
    const { vendor } = await loadIntegration();

    expect(
      identify(vendor, {
        announcement: { instance: 'Desk', txt: { md: 'EL-F1', id: 'el-0043', fw: '2.1.0' } },
      }),
    ).toMatchObject({
      matches: true,
      identity: { externalId: 'el-0043', modelCode: 'EL-F1' },
      association: { driverId: 'lamp', model: 'Floor Lamp' },
    });
  });
});
