/**
 * The Bambu Lab vendor, loaded the way the hub loads it: what it ships, how the owner is offered
 * its printers, and what every driver registers - the checks the platform made of the bundle
 * while it shipped with the hub, kept here now that it ships on its own.
 */
import { describe, expect, it } from 'vitest';

import { driverHarness, loadIntegration } from '@nebulahome/integration-sdk/testing';

/** The drivers, one per family of printers. */
const DRIVERS = ['printer', 'printer-dual-nozzle', 'printer-p1-a1', 'printer-p2s-h2s'];

/**
 * The catalogue icons the vendor names - each checked against the platform's icon catalogue when
 * the vendor moved here. One that is not in the catalogue is a blank tile on the devices page,
 * so a new one is checked there before it is added to this list.
 */
const CATALOGUE_ICONS = new Set([
  'cloud',
  'code',
  'door-open',
  'droplets',
  'fan',
  'file',
  'file-text',
  'film',
  'gauge',
  'hard-drive',
  'heater',
  'layers',
  'light',
  'list',
  'pause',
  'percent',
  'play',
  'printer',
  'refresh-cw',
  'square',
  'thermometer',
  'timer',
  'triangle-alert',
  'video',
  'wifi',
]);

/**
 * The unit each numeric sensor class the vendor uses registers in: the catalogue's canonical
 * one, which `core` refuses a registration without.
 */
const CANONICAL_UNITS: Readonly<Record<string, string>> = {
  temperature: '°C',
  humidity: '%',
  duration: 's',
};

/** A serial and its report topic, for a printer added through a driver. */
const SERIAL = '01P00A123456789';
const REPORT_TOPIC = `device/${SERIAL}/report`;

/**
 * Wraps a message the way the MQTT transport delivers it.
 *
 * @param message - What the printer published.
 * @returns The payload an integration sees.
 */
function onReportTopic(message: unknown): { topic: string; segments: string[]; message: unknown } {
  return { topic: REPORT_TOPIC, segments: ['device', SERIAL, 'report'], message };
}

describe('the Bambu Lab vendor', () => {
  it('loads as the hub loads it, with nothing skipped', async () => {
    const integration = await loadIntegration();

    expect(integration.failures).toEqual([]);
    expect(integration.vendor.manifest.id).toBe('bambulab');
    expect(integration.vendor.drivers.map((driver) => driver.driverId).sort()).toEqual(DRIVERS);
    expect(integration.vendor.transports).toEqual(['mqtt']);
    expect(integration.vendor.ownTransports).toEqual([]);
    expect(integration.vendor.streams.map((stream) => stream.id)).toEqual(['bambulab/camera']);
    expect(
      integration.vendor.discovery?.sources.map((source) =>
        source.kind === 'module' ? source.file : source.service,
      ),
    ).toEqual(['./lan/discovery.js']);
  });

  it('has a logo the interface can show', async () => {
    const { vendor } = await loadIntegration();

    expect(vendor.logo).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('offers every Bambu Lab printer as its own choice, one driver per family', async () => {
    // One profile per family - the X1s, the P2S and H2S, the dual-nozzle printers, the P1s and
    // A1s - but the owner adding one is asked which printer, and the answer is what the vendor
    // page shows for the row.
    const { vendor } = await loadIntegration();

    expect(
      Object.fromEntries(
        vendor.drivers.map((driver) => [driver.manifest.id, driver.manifest.models]),
      ),
    ).toEqual({
      'bambulab/printer': ['X1', 'X1C', 'X1E'],
      'bambulab/printer-p2s-h2s': ['P2S', 'H2S'],
      'bambulab/printer-dual-nozzle': ['H2D', 'H2D Pro', 'H2C', 'X2D'],
      'bambulab/printer-p1-a1': ['P1P', 'P1S', 'A1', 'A1 mini', 'A2L'],
    });
  });

  it('puts every Bambu Lab printer in the series it is sold as, whichever driver runs it', async () => {
    // The drivers follow what the hardware needs - an X1C and an X2D differ in almost every
    // entity - and the owner knows the printers by series: the form groups them so.
    const { vendor } = await loadIntegration();
    const series = Object.assign(
      {},
      ...vendor.drivers.map((driver) => driver.manifest.modelSeries ?? {}),
    ) as Record<string, string>;

    expect(series).toEqual({
      X1: 'X series',
      X1C: 'X series',
      X1E: 'X series',
      X2D: 'X series',
      H2D: 'H series',
      'H2D Pro': 'H series',
      H2C: 'H series',
      H2S: 'H series',
      P1P: 'P series',
      P1S: 'P series',
      P2S: 'P series',
      A1: 'A series',
      'A1 mini': 'A series',
      A2L: 'A series',
    });
  });

  it('includes the Bambu Lab printer, over MQTT and declarative', async () => {
    const integration = await loadIntegration();
    const bambu = integration.driver('printer');

    expect(bambu.manifest.id).toBe('bambulab/printer');
    expect(bambu.manifest.transport).toBe('mqtt');
    expect(bambu.manifest.kind).toBe('declarative');
  });
});

describe('what every driver registers', () => {
  it('is not polled, so offers no interval: the printer pushes, and is asked every five minutes', async () => {
    const integration = await loadIntegration();

    for (const driverId of DRIVERS) {
      const driver = integration.driver(driverId);
      const harness = driverHarness(driver);

      harness.add({ deviceKey: REPORT_TOPIC, payload: onReportTopic({ print: {} }) });

      const subscriptions = harness.subscriptions();

      expect(
        subscriptions.filter((subscription) => subscription.op === 'poll'),
        driverId,
      ).toEqual([]);
      expect(
        driver.setup.options.fields.find((field) => field.key === 'pollInterval'),
        driverId,
      ).toBeUndefined();
      expect(
        subscriptions.find((subscription) => subscription.op === 'publish')?.args['everyMs'],
        driverId,
      ).toBe(300_000);
    }
  });

  it('gives every driver and every entity an icon the catalogue has', async () => {
    const integration = await loadIntegration();

    for (const driverId of DRIVERS) {
      const driver = integration.driver(driverId);
      const { device } = driverHarness(driver).add({
        deviceKey: REPORT_TOPIC,
        payload: onReportTopic({ print: {} }),
      });

      expect(CATALOGUE_ICONS.has(driver.manifest.defaultIcon ?? ''), driverId).toBe(true);

      for (const entity of device.entities) {
        const label = `${driverId} ${entity.objectId ?? entity.domain}`;

        expect(entity.icon, `${label} names no icon`).toBeDefined();
        expect(
          CATALOGUE_ICONS.has(entity.icon ?? ''),
          `${label} names ${String(entity.icon)}`,
        ).toBe(true);
      }
    }
  });

  it('registers every reading in the unit its sensor class registers in', async () => {
    // `core` refuses a registration whose unit does not belong to its class, so a wrong unit
    // here is a device that is identified and then never completed - found on hardware, late.
    const integration = await loadIntegration();

    for (const driverId of DRIVERS) {
      const { device } = driverHarness(integration.driver(driverId)).add({
        deviceKey: REPORT_TOPIC,
        payload: onReportTopic({ print: {} }),
      });

      for (const entity of device.entities) {
        if (entity.capabilities.sensor_numeric === undefined || entity.deviceClass === undefined) {
          continue;
        }

        const label = `${driverId} ${entity.objectId ?? entity.domain}`;

        expect(Object.keys(CANONICAL_UNITS), label).toContain(entity.deviceClass);
        expect(entity.unitOfMeasurement, label).toBe(CANONICAL_UNITS[entity.deviceClass]);
      }
    }
  });

  it('converts every reading from the unit the printer speaks: the minutes left, to seconds', async () => {
    // A native unit the catalogue cannot convert publishes nothing at all: the reading is
    // dropped rather than stored in the wrong unit.
    const integration = await loadIntegration();

    for (const driverId of DRIVERS) {
      const harness = driverHarness(integration.driver(driverId), { deviceId: 'printer' });

      harness.add({ deviceKey: REPORT_TOPIC, payload: onReportTopic({ print: {} }) });

      expect(
        harness
          .receive(onReportTopic({ print: { mc_remaining_time: 87 } }))
          .find((report) => report.entityId === 'sensor.printer_remaining_time')?.state,
        driverId,
      ).toEqual({ sensor_numeric: { value: 5220 } });
    }
  });
});
