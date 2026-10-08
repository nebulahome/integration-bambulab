/**
 * The examples' transport and discovery module, handed a fake SDK: what they send, and what they
 * make of what a lamp sends back. Their UDP sockets are the fake's, so no port is bound.
 */
import { getEventListeners } from 'node:events';

import { describe, expect, it } from 'vitest';

import type { TransportInbound } from '@nebulahome/integration-sdk';
import { createFakeSdk } from '@nebulahome/integration-sdk/testing';

import discovery from './lan/discovery.js';
import transport from './lan/transport.js';

describe('the lan transport', () => {
  it("delivers what the lamp sends, and sends a driver's request as one packet", async () => {
    const fake = createFakeSdk();
    const lan = transport(fake.sdk);
    const delivered: TransportInbound[] = [];
    const connection = await lan.connect(
      { host: '192.0.2.5' },
      {
        logger: fake.sdk.logger,
        deliver: (message) => delivered.push(message),
        report: () => undefined,
      },
    );
    const [socket] = fake.udpSockets;

    await connection.send(
      { deviceKey: '192.0.2.5', op: 'set', args: { on: true } },
      AbortSignal.timeout(1000),
    );
    socket?.deliver('{"on":true}', { address: '192.0.2.5', port: 4003 });
    socket?.deliver('{"on":false}', { address: '192.0.2.99', port: 4003 });
    await connection.close();

    expect(socket?.sent.map((packet) => packet.message.toString())).toEqual([
      '{"cmd":"set","on":true}',
      '{"cmd":"state"}',
    ]);
    expect(delivered).toEqual([
      { connectionKey: '192.0.2.5', deviceKey: '192.0.2.5', payload: { on: true } },
    ]);
    expect(socket?.isClosed).toBe(true);
  });

  it('answers a Test with what the lamp says of itself, and lets its socket go', async () => {
    const fake = createFakeSdk();
    const probed = transport(fake.sdk).probe({ host: '192.0.2.5' }, AbortSignal.timeout(1000));
    const [socket] = fake.udpSockets;

    socket?.deliver('{"name":"Desk"}', { address: '192.0.2.5', port: 4003 });

    await expect(probed).resolves.toBe('Desk answered');
    expect(socket?.sent[0]?.message.toString()).toBe('{"cmd":"info"}');
    expect(socket?.isClosed).toBe(true);
  });

  it('gives a Test up when it is stopped, without a socket left open', async () => {
    const fake = createFakeSdk();
    const stop = new AbortController();
    const probed = transport(fake.sdk).probe({ host: '192.0.2.5' }, stop.signal);

    stop.abort();

    await expect(probed).rejects.toThrow('Nothing answered on 192.0.2.5:4003');
    expect(fake.udpSockets.every((socket) => socket.isClosed)).toBe(true);
    await expect(transport(fake.sdk).probe({ host: '192.0.2.5' }, stop.signal)).rejects.toThrow(
      'Nothing answered',
    );
  });
});

describe('the lan discovery', () => {
  it('asks the network, and reports each lamp that answers with how to reach it', async () => {
    const fake = createFakeSdk();
    const stop = new AbortController();
    const listening = discovery(fake.sdk)
      .listen(stop.signal, { settings: async () => ({}) })
      [Symbol.asyncIterator]();
    const first = listening.next();
    const [socket] = fake.udpSockets;

    socket?.deliver('{"vendor":"Other"}', { address: '192.0.2.6', port: 4003 });
    socket?.deliver('{"vendor":"Example","model":"EL-D1"}', { address: '192.0.2.7', port: 4003 });

    expect((await first).value).toEqual({
      config: { host: '192.0.2.7' },
      payload: { vendor: 'Example', model: 'EL-D1' },
    });
    expect(socket?.sent[0]?.message.toString()).toBe('{"cmd":"scan"}');

    // Each answer waited for adds nothing to the signal: a listener of hours stays one listener.
    for (const address of ['192.0.2.8', '192.0.2.9']) {
      const heard = listening.next();

      // The listener is waiting again before the lamp answers, as it is between two answers.
      await new Promise((resolve) => setImmediate(resolve));
      socket?.deliver('{"vendor":"Example"}', { address, port: 4003 });
      await heard;
    }

    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(1);

    stop.abort();
    await listening.return?.(undefined);

    expect(socket?.isClosed).toBe(true);
  });
});
