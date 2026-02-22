use bytes::{Buf, BufMut, Bytes, BytesMut};
use std::fmt;

/// Media packet track type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TrackType {
    Audio = 0,
    Video = 1,
}

impl TryFrom<u8> for TrackType {
    type Error = ProtocolError;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(TrackType::Audio),
            1 => Ok(TrackType::Video),
            _ => Err(ProtocolError::InvalidTrackType(value)),
        }
    }
}

/// 16-byte media packet header.
///
/// ```text
/// Byte 0:     [V:1][T:1][R:2][SimLyr:4]
/// Bytes 1-2:  Sequence number (u16)
/// Bytes 3-6:  Timestamp (u32, 48kHz audio / 90kHz video)
/// Bytes 7-10: SSRC (u32)
/// Byte 11:    Audio level (u8, dBov 0-127, 127=silence)
/// Byte 12:    Key epoch (u8)
/// Bytes 13-14: Payload length (u16)
/// Byte 15:    Reserved
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MediaHeader {
    pub version: u8,
    pub track_type: TrackType,
    pub simulcast_layer: u8,
    pub sequence: u16,
    pub timestamp: u32,
    pub ssrc: u32,
    pub audio_level: u8,
    pub key_epoch: u8,
    pub payload_length: u16,
}

pub const HEADER_SIZE: usize = 16;
pub const PROTOCOL_VERSION: u8 = 1;

impl MediaHeader {
    pub fn new(track_type: TrackType, ssrc: u32) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            track_type,
            simulcast_layer: 0,
            sequence: 0,
            timestamp: 0,
            ssrc,
            audio_level: 127, // silence
            key_epoch: 0,
            payload_length: 0,
        }
    }

    /// Serialize header to 16 bytes.
    pub fn encode(&self, buf: &mut BytesMut) {
        // Byte 0: [V:1][T:1][R:2][SimLyr:4]
        let byte0 = ((self.version & 0x01) << 7)
            | (((self.track_type as u8) & 0x01) << 6)
            | (self.simulcast_layer & 0x0F);
        buf.put_u8(byte0);
        buf.put_u16(self.sequence);
        buf.put_u32(self.timestamp);
        buf.put_u32(self.ssrc);
        buf.put_u8(self.audio_level);
        buf.put_u8(self.key_epoch);
        buf.put_u16(self.payload_length);
        buf.put_u8(0); // reserved
    }

    /// Deserialize header from bytes.
    pub fn decode(buf: &mut impl Buf) -> Result<Self, ProtocolError> {
        if buf.remaining() < HEADER_SIZE {
            return Err(ProtocolError::BufferTooShort {
                expected: HEADER_SIZE,
                actual: buf.remaining(),
            });
        }

        let byte0 = buf.get_u8();
        let version = (byte0 >> 7) & 0x01;
        let track_type = TrackType::try_from((byte0 >> 6) & 0x01)?;
        let simulcast_layer = byte0 & 0x0F;
        let sequence = buf.get_u16();
        let timestamp = buf.get_u32();
        let ssrc = buf.get_u32();
        let audio_level = buf.get_u8();
        let key_epoch = buf.get_u8();
        let payload_length = buf.get_u16();
        let _reserved = buf.get_u8();

        Ok(Self {
            version,
            track_type,
            simulcast_layer,
            sequence,
            timestamp,
            ssrc,
            audio_level,
            key_epoch,
            payload_length,
        })
    }

    /// Encode header into a new Bytes.
    pub fn to_bytes(&self) -> Bytes {
        let mut buf = BytesMut::with_capacity(HEADER_SIZE);
        self.encode(&mut buf);
        buf.freeze()
    }
}

impl fmt::Display for MediaHeader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "MediaHeader(v={}, {:?}, layer={}, seq={}, ts={}, ssrc={:#x}, level={}, epoch={}, len={})",
            self.version, self.track_type, self.simulcast_layer,
            self.sequence, self.timestamp, self.ssrc,
            self.audio_level, self.key_epoch, self.payload_length
        )
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("buffer too short: expected {expected}, got {actual}")]
    BufferTooShort { expected: usize, actual: usize },
    #[error("invalid track type: {0}")]
    InvalidTrackType(u8),
    #[error("unsupported protocol version: {0}")]
    UnsupportedVersion(u8),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_round_trip() {
        let header = MediaHeader {
            version: 1,
            track_type: TrackType::Audio,
            simulcast_layer: 0,
            sequence: 1234,
            timestamp: 567890,
            ssrc: 0xDEADBEEF,
            audio_level: 42,
            key_epoch: 3,
            payload_length: 960,
        };

        let bytes = header.to_bytes();
        assert_eq!(bytes.len(), HEADER_SIZE);

        let decoded = MediaHeader::decode(&mut bytes.as_ref()).unwrap();
        assert_eq!(header, decoded);
    }

    #[test]
    fn header_video_simulcast() {
        let header = MediaHeader {
            version: 1,
            track_type: TrackType::Video,
            simulcast_layer: 2,
            sequence: 100,
            timestamp: 9000,
            ssrc: 0x12345678,
            audio_level: 127,
            key_epoch: 1,
            payload_length: 4096,
        };

        let bytes = header.to_bytes();
        let decoded = MediaHeader::decode(&mut bytes.as_ref()).unwrap();
        assert_eq!(header, decoded);
    }

    #[test]
    fn buffer_too_short() {
        let buf = vec![0u8; 8];
        let result = MediaHeader::decode(&mut buf.as_slice());
        assert!(matches!(result, Err(ProtocolError::BufferTooShort { .. })));
    }
}
