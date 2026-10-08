/**
 * A Bambu Lab printer in the P1 and A1 family, and a printer that behaves like one.
 *
 * The printer is simulated, because there is not one on the test bench, and the simulation is
 * narrow on purpose: it answers `pushall` with a full report and `ledctrl` with a delta naming
 * only the light, which is what a P1 or an A1 does. What this proves is the wiring between the
 * two ends: that what the printer says on its report topic, during a scan, is claimed by its
 * serial; that identifying it asks it for everything on its own request topic; that the answer
 * lands on the right entities; and that a command goes back the way the firmware expects and its
 * effect comes back as state.
 *
 * The broker between them is the platform's MQTT transport, and not here: subscribing to a filter,
 * handing a message over with its topic in segments and publishing a request to a topic written
 * in segments are the transport's, tested with the platform. Each message below is wrapped the way
 * that transport delivers it. TLS is not exercised either: `shouldVerifyCertificate` is a constant
 * of the setup, passed straight through to the client.
 */
import { describe, expect, it } from 'vitest';

import type { ReportedState, TransportRequest } from '@nebulahome/integration-sdk';
import {
  driverHarness,
  loadIntegration,
  type DriverHarness,
  type HarnessDevice,
} from '@nebulahome/integration-sdk/testing';

/** The driver of the P1 and A1 family, which the simulated printer is one of. */
const DRIVER = 'printer-p1-a1';

/** The printer's serial. */
const SERIAL = '01P00A000000042';

/** What the printer holds and reports. */
const printer = {
  isLightOn: false,
  nozzle: 25.4,
  bed: 24.1,
};

/**
 * Wraps what the printer published on its report topic the way the MQTT transport delivers it.
 *
 * @param message - The body.
 * @returns What the driver is handed: by a scan, or by the connection.
 */
function report(message: unknown): { topic: string; segments: string[]; message: unknown } {
  return { topic: `device/${SERIAL}/report`, segments: ['device', SERIAL, 'report'], message };
}

/**
 * The full status the printer answers a `pushall` with.
 *
 * @returns The report.
 */
function fullReport(): unknown {
  return {
    print: {
      nozzle_temper: printer.nozzle,
      nozzle_target_temper: 0,
      bed_temper: printer.bed,
      bed_target_temper: 0,
      gcode_state: 'IDLE',
      mc_percent: 0,
      mc_remaining_time: 0,
      lights_report: [{ node: 'chamber_light', mode: printer.isLightOn ? 'on' : 'off' }],
      command: 'push_status',
      msg: 0,
      sequence_id: '1',
    },
  };
}

/**
 * The printer: answers a `pushall` with everything, and a `ledctrl` by doing it and saying so
 * with a delta that names the light and nothing else. It hears only its own request topic.
 *
 * @param published - The topic, in segments, and the body published to it.
 * @param published.topic - The topic.
 * @param published.payload - The body.
 * @returns What the printer published back on its report topic, wrapped as delivered.
 */
function simulator(published: { topic: unknown; payload: unknown }): unknown[] {
  if (!Array.isArray(published.topic) || published.topic.join('/') !== `device/${SERIAL}/request`) {
    return [];
  }

  const request = published.payload as {
    pushing?: { command?: string };
    system?: { command?: string; led_mode?: string };
  };
  const answers: unknown[] = [];

  if (request.pushing?.command === 'pushall') {
    answers.push(report(fullReport()));
  }

  if (request.system?.command === 'ledctrl') {
    printer.isLightOn = request.system.led_mode === 'on';
    answers.push(
      report({
        print: {
          lights_report: [{ node: 'chamber_light', mode: printer.isLightOn ? 'on' : 'off' }],
          command: 'push_status',
          msg: 1,
          sequence_id: '2',
        },
      }),
    );
  }

  return answers;
}

/**
 * Reads the states the reports name, by object id; the buttons, reported empty on anything the
 * printer says, left out.
 *
 * @param added - The printer, as added.
 * @param reports - What the driver reported.
 * @returns Each entity's state, keyed by object id.
 */
function statesOf(
  added: HarnessDevice,
  reports: readonly ReportedState[],
): Map<string, ReportedState['state']> {
  const byId = new Map([...added.entities].map(([objectId, entityId]) => [entityId, objectId]));

  return new Map(
    reports
      .filter((each) => !each.entityId.startsWith('button.'))
      .map((each) => [byId.get(each.entityId) ?? '?', each.state]),
  );
}

/**
 * The P1 driver, with the printer added the way a scan found it.
 *
 * @returns The driver, driven, and the printer.
 */
async function identified(): Promise<{
  readonly harness: DriverHarness;
  readonly added: HarnessDevice;
}> {
  const harness = driverHarness((await loadIntegration()).driver(DRIVER), { deviceId: 'p1s' });
  const added = harness.add({
    deviceKey: `device/${SERIAL}/report`,
    payload: report({ print: { nozzle_temper: printer.nozzle, command: 'push_status' } }),
  });

  return { harness, added };
}

describe('a Bambu Lab printer on the broker', () => {
  it('is found by a scan, and claimed by its serial', async () => {
    const harness = driverHarness((await loadIntegration()).driver(DRIVER));

    // A scan is a subscription to what the driver looks for; the printer speaks while it runs.
    expect(harness.integration.discovery).toMatchObject({ filter: 'device/+/report' });

    const claim = harness.claim({
      deviceKey: `device/${SERIAL}/report`,
      payload: report({ print: { nozzle_temper: printer.nozzle, command: 'push_status' } }),
    });

    expect(claim?.externalId).toBe(SERIAL);
  });

  it('is asked for everything once identified, and answers with its temperatures', async () => {
    const { harness, added } = await identified();
    const asked = harness.subscriptions().filter((each) => each.op === 'publish');

    expect(asked).toHaveLength(1);

    const answers = asked.flatMap((each) =>
      simulator({ topic: each.args['topic'], payload: each.args['payload'] }),
    );

    expect(answers).toHaveLength(1);

    const states = statesOf(added, harness.receive(answers[0]));

    expect(states.get('nozzle_temperature')).toEqual({ sensor_numeric: { value: 25.4 } });
    expect(states.get('bed_temperature')).toEqual({ sensor_numeric: { value: 24.1 } });
    expect(states.get('printing')).toEqual({ sensor_binary: { isOn: false } });
    expect(states.get('chamber_light')).toEqual({ on_off: { isOn: false } });
  });

  it('turns the light on the way the firmware expects, and hears it come on', async () => {
    const { harness, added } = await identified();
    const request: TransportRequest = harness.command('light.p1s_chamber_light', 'on_off', {
      command: 'turn_on',
    });

    expect(request.op).toBe('publish');

    const answers = simulator({ topic: request.args['topic'], payload: request.args['payload'] });

    expect(answers).toHaveLength(1);

    // The printer answered with a delta naming the light and nothing else, which is what a P1
    // does. Only the light must change.
    const states = statesOf(added, harness.receive(answers[0]));

    expect(printer.isLightOn).toBe(true);
    expect([...states.keys()]).toEqual(['chamber_light']);
    expect(states.get('chamber_light')).toEqual({ on_off: { isOn: true } });
  });
});
