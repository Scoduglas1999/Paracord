// Packet header serialization (matches Rust paracord-transport::protocol).

export const HEADER_SIZE = 16;
export const PROTOCOL_VERSION = 1;

export const enum TrackType {
  Audio = 0,
  Video = 1,
}

export interface MediaHeader {
  version: number;
  trackType: TrackType;
  simulcastLayer: number;
  sequence: number;
  timestamp: number;
  ssrc: number;
  audioLevel: number;
  keyEpoch: number;
  payloadLength: number;
}

export function encodeHeader(header: MediaHeader): DataView {
  const buf = new DataView(new ArrayBuffer(HEADER_SIZE));
  const byte0 =
    ((header.version & 0x01) << 7) |
    ((header.trackType & 0x01) << 6) |
    (header.simulcastLayer & 0x0f);
  buf.setUint8(0, byte0);
  buf.setUint16(1, header.sequence, false);
  buf.setUint32(3, header.timestamp, false);
  buf.setUint32(7, header.ssrc, false);
  buf.setUint8(11, header.audioLevel);
  buf.setUint8(12, header.keyEpoch);
  buf.setUint16(13, header.payloadLength, false);
  buf.setUint8(15, 0); // reserved
  return buf;
}

export function decodeHeader(buf: DataView): MediaHeader {
  if (buf.byteLength < HEADER_SIZE) {
    throw new Error(
      `Buffer too short: expected ${HEADER_SIZE}, got ${buf.byteLength}`
    );
  }
  const byte0 = buf.getUint8(0);
  return {
    version: (byte0 >> 7) & 0x01,
    trackType: ((byte0 >> 6) & 0x01) as TrackType,
    simulcastLayer: byte0 & 0x0f,
    sequence: buf.getUint16(1, false),
    timestamp: buf.getUint32(3, false),
    ssrc: buf.getUint32(7, false),
    audioLevel: buf.getUint8(11),
    keyEpoch: buf.getUint8(12),
    payloadLength: buf.getUint16(13, false),
  };
}

/** Create a complete media packet: 16-byte header + payload. */
export function createPacket(header: MediaHeader, payload: Uint8Array): Uint8Array {
  const headerView = encodeHeader({ ...header, payloadLength: payload.byteLength });
  const packet = new Uint8Array(HEADER_SIZE + payload.byteLength);
  packet.set(new Uint8Array(headerView.buffer), 0);
  packet.set(payload, HEADER_SIZE);
  return packet;
}

/** Parse a complete packet into header + payload. */
export function parsePacket(data: Uint8Array): { header: MediaHeader; payload: Uint8Array } {
  if (data.byteLength < HEADER_SIZE) {
    throw new Error(`Packet too short: expected at least ${HEADER_SIZE}, got ${data.byteLength}`);
  }
  const headerView = new DataView(data.buffer, data.byteOffset, HEADER_SIZE);
  const header = decodeHeader(headerView);
  const payload = data.slice(HEADER_SIZE, HEADER_SIZE + header.payloadLength);
  return { header, payload };
}
