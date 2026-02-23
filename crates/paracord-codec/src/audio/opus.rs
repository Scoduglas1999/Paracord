// Opus encode/decode wrapper.

use audiopus::{
    coder::{Decoder as OpusDecoderInner, Encoder as OpusEncoderInner},
    packet::Packet,
    Application, Bitrate, Channels, MutSignals, SampleRate,
};
use thiserror::Error;

/// 48 kHz sample rate (native for Opus).
pub const SAMPLE_RATE: u32 = 48_000;
/// 20 ms frame at 48 kHz = 960 samples.
pub const FRAME_SIZE: usize = 960;
/// Maximum Opus packet size (recommended by RFC 6716).
const MAX_PACKET_SIZE: usize = 4000;

#[derive(Debug, Error)]
pub enum OpusError {
    #[error("opus encoder error: {0}")]
    Encoder(#[from] audiopus::Error),
    #[error("frame size mismatch: expected {expected}, got {actual}")]
    FrameSizeMismatch { expected: usize, actual: usize },
}

/// Opus encoder configured for voice at 48 kHz mono.
pub struct OpusEncoder {
    inner: OpusEncoderInner,
    encode_buf: Vec<u8>,
}

impl OpusEncoder {
    /// Create a new Opus encoder.
    ///
    /// - 48 kHz mono
    /// - Voip application (voice-optimized)
    /// - 96 kbps default bitrate
    /// - FEC enabled for packet loss resilience
    /// - DTX enabled for silence suppression
    pub fn new() -> Result<Self, OpusError> {
        let mut encoder =
            OpusEncoderInner::new(SampleRate::Hz48000, Channels::Mono, Application::Voip)?;

        encoder.set_bitrate(Bitrate::BitsPerSecond(96_000))?;

        // Low complexity for low latency
        encoder.set_complexity(5)?;

        // Enable in-band FEC
        encoder.set_inband_fec(true)?;

        // Enable DTX (discontinuous transmission) for silence suppression
        encoder.set_dtx(true)?;

        // Set expected packet loss percentage for FEC tuning
        encoder.set_packet_loss_perc(10u8)?;

        Ok(Self {
            inner: encoder,
            encode_buf: vec![0u8; MAX_PACKET_SIZE],
        })
    }

    /// Encode a 20 ms frame of PCM f32 mono samples (960 samples at 48 kHz).
    /// Returns the encoded Opus packet bytes.
    pub fn encode(&mut self, pcm: &[f32]) -> Result<Vec<u8>, OpusError> {
        if pcm.len() != FRAME_SIZE {
            return Err(OpusError::FrameSizeMismatch {
                expected: FRAME_SIZE,
                actual: pcm.len(),
            });
        }

        let len = self.inner.encode_float(pcm, &mut self.encode_buf)?;
        Ok(self.encode_buf[..len].to_vec())
    }

    /// Set the bitrate in bits per second.
    pub fn set_bitrate(&mut self, bps: i32) -> Result<(), OpusError> {
        self.inner.set_bitrate(Bitrate::BitsPerSecond(bps))?;
        Ok(())
    }

    /// Set expected packet loss percentage (0-100) to tune FEC behavior.
    pub fn set_packet_loss_perc(&mut self, pct: u8) -> Result<(), OpusError> {
        self.inner.set_packet_loss_perc(pct)?;
        Ok(())
    }
}

/// Opus decoder for a single remote participant.
pub struct OpusDecoder {
    inner: OpusDecoderInner,
    decode_buf: Vec<f32>,
}

impl OpusDecoder {
    /// Create a new Opus decoder (48 kHz mono).
    pub fn new() -> Result<Self, OpusError> {
        let decoder = OpusDecoderInner::new(SampleRate::Hz48000, Channels::Mono)?;
        Ok(Self {
            inner: decoder,
            decode_buf: vec![0.0f32; FRAME_SIZE],
        })
    }

    /// Decode an Opus packet into PCM f32 mono samples.
    /// Returns exactly `FRAME_SIZE` (960) samples for a 20 ms frame.
    pub fn decode(&mut self, packet_data: &[u8]) -> Result<Vec<f32>, OpusError> {
        let pkt: Packet<'_> = packet_data.try_into()?;
        let output: MutSignals<'_, f32> = (&mut self.decode_buf[..]).try_into()?;
        let len = self.inner.decode_float(Some(pkt), output, false)?;
        Ok(self.decode_buf[..len].to_vec())
    }

    /// Perform packet loss concealment (PLC).
    /// Called when a packet is missing; the decoder generates a best-guess frame.
    pub fn decode_plc(&mut self) -> Result<Vec<f32>, OpusError> {
        let output: MutSignals<'_, f32> = (&mut self.decode_buf[..]).try_into()?;
        let len = self.inner.decode_float(None, output, false)?;
        Ok(self.decode_buf[..len].to_vec())
    }

    /// Decode with FEC. If the *next* packet has arrived but the *current* one
    /// was lost, pass the next packet here with `fec=true` to recover the
    /// lost frame from the forward error correction data.
    pub fn decode_fec(&mut self, next_packet_data: &[u8]) -> Result<Vec<f32>, OpusError> {
        let pkt: Packet<'_> = next_packet_data.try_into()?;
        let output: MutSignals<'_, f32> = (&mut self.decode_buf[..]).try_into()?;
        let len = self.inner.decode_float(Some(pkt), output, true)?;
        Ok(self.decode_buf[..len].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_round_trip() {
        let mut encoder = OpusEncoder::new().expect("encoder creation failed");
        let mut decoder = OpusDecoder::new().expect("decoder creation failed");

        // Encode silence (960 zero samples)
        let silence = vec![0.0f32; FRAME_SIZE];
        let packet = encoder.encode(&silence).expect("encode failed");
        assert!(!packet.is_empty());

        // Decode
        let decoded = decoder.decode(&packet).expect("decode failed");
        assert_eq!(decoded.len(), FRAME_SIZE);

        // Decoded silence should be near-zero
        for &sample in &decoded {
            assert!(
                sample.abs() < 0.01,
                "decoded sample too far from silence: {sample}"
            );
        }
    }

    #[test]
    fn encode_decode_tone() {
        let mut encoder = OpusEncoder::new().expect("encoder creation failed");
        let mut decoder = OpusDecoder::new().expect("decoder creation failed");

        // Generate a 440Hz sine wave
        let pcm: Vec<f32> = (0..FRAME_SIZE)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / SAMPLE_RATE as f32).sin())
            .collect();

        let packet = encoder.encode(&pcm).expect("encode failed");
        assert!(!packet.is_empty());

        let decoded = decoder.decode(&packet).expect("decode failed");
        assert_eq!(decoded.len(), FRAME_SIZE);

        // Check that decoded signal has non-trivial energy
        let energy: f32 = decoded.iter().map(|s| s * s).sum::<f32>() / decoded.len() as f32;
        assert!(
            energy > 0.01,
            "decoded tone has too little energy: {energy}"
        );
    }

    #[test]
    fn plc_does_not_crash() {
        let mut decoder = OpusDecoder::new().expect("decoder creation failed");
        let plc = decoder.decode_plc().expect("PLC failed");
        assert_eq!(plc.len(), FRAME_SIZE);
    }

    #[test]
    fn wrong_frame_size_rejected() {
        let mut encoder = OpusEncoder::new().expect("encoder creation failed");
        let bad_pcm = vec![0.0f32; 480]; // 10ms instead of 20ms
        let result = encoder.encode(&bad_pcm);
        assert!(result.is_err());
    }
}
