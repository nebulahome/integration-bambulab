/**
 * The example lamps' protocol: one JSON object per datagram, on UDP port 4003. A module the
 * transport and the discovery module share - the build puts what they share in one chunk.
 */

/** Where the lamps listen, and answer from. */
export const LAN_PORT = 4003;

/** One message, either way. */
export type Packet = Readonly<Record<string, unknown>>;

/**
 * Writes a message.
 *
 * @param packet - The message.
 * @returns Its bytes.
 */
export function writePacket(packet: Packet): string {
  return JSON.stringify(packet);
}

/**
 * Reads a message.
 *
 * @param message - The datagram.
 * @returns The message, or null for one that is not a JSON object.
 */
export function readPacket(message: Buffer): Packet | null {
  try {
    const parsed: unknown = JSON.parse(message.toString('utf8'));

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Packet)
      : null;
  } catch {
    return null;
  }
}
