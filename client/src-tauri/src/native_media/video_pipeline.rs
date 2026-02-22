use super::session::NativeMediaSession;
use paracord_transport::protocol::MediaHeader;

#[cfg(feature = "vpx")]
use bytes::{BufMut, BytesMut};
#[cfg(feature = "vpx")]
use paracord_transport::protocol::{TrackType, HEADER_SIZE};

/// Enable or disable the camera video encoder.
pub fn set_video_enabled(session: &mut NativeMediaSession, enabled: bool) -> Result<(), String> {
    #[cfg(feature = "vpx")]
    {
        if enabled {
            if session.video_encoder.is_none() {
                use paracord_codec::video::encoder::Vp9Encoder;
                use paracord_codec::video::{EncoderConfig, PixelFormat, SimulcastLayer};

                let config = EncoderConfig::for_layer(SimulcastLayer::Medium, PixelFormat::Rgba);
                let encoder =
                    Vp9Encoder::new(config).map_err(|e| format!("vp9 encoder init: {e}"))?;
                session.video_encoder = Some(Box::new(encoder));
            }
        } else {
            session.video_encoder = None;
        }
        Ok(())
    }

    #[cfg(not(feature = "vpx"))]
    {
        let _ = (session, enabled);
        Err("video encoding requires the 'vpx' feature".into())
    }
}

/// Start screen share encoder (separate SSRC from camera).
pub fn start_screen_share(session: &mut NativeMediaSession) -> Result<(), String> {
    #[cfg(feature = "vpx")]
    {
        if session.screen_encoder.is_none() {
            use paracord_codec::video::encoder::Vp9Encoder;
            use paracord_codec::video::{EncoderConfig, PixelFormat, SimulcastLayer};

            let config = EncoderConfig::for_layer(SimulcastLayer::High, PixelFormat::Rgba);
            let encoder =
                Vp9Encoder::new(config).map_err(|e| format!("vp9 screen encoder init: {e}"))?;
            session.screen_encoder = Some(Box::new(encoder));
        }
        Ok(())
    }

    #[cfg(not(feature = "vpx"))]
    {
        let _ = session;
        Err("screen share encoding requires the 'vpx' feature".into())
    }
}

/// Stop screen share encoder.
pub fn stop_screen_share(session: &mut NativeMediaSession) {
    #[cfg(feature = "vpx")]
    {
        session.screen_encoder = None;
    }

    #[cfg(not(feature = "vpx"))]
    let _ = session;
}

/// Encode an RGBA frame and send it as a QUIC datagram.
/// `is_screen` selects whether to use the screen or camera encoder/SSRC.
pub fn encode_and_send_video_frame(
    session: &mut NativeMediaSession,
    _width: u32,
    _height: u32,
    rgba_data: &[u8],
    is_screen: bool,
) -> Result<(), String> {
    #[cfg(feature = "vpx")]
    {
        use paracord_codec::video::encoder::VideoEncoder;

        let (encoder, ssrc, seq) = if is_screen {
            let enc = session
                .screen_encoder
                .as_mut()
                .ok_or("screen encoder not active")?;
            (enc, session.screen_ssrc, &mut session.screen_seq)
        } else {
            let enc = session
                .video_encoder
                .as_mut()
                .ok_or("video encoder not active")?;
            (enc, session.video_ssrc, &mut session.video_seq)
        };

        let pts = *seq as i64;
        let encoded_frames = encoder
            .encode(pts, rgba_data, false)
            .map_err(|e| format!("video encode: {e}"))?;

        for frame in encoded_frames {
            let mut header = MediaHeader::new(TrackType::Video, ssrc);
            header.sequence = *seq;
            header.timestamp = *seq as u32 * 3000; // 90kHz clock, ~30fps
            header.key_epoch = session.key_epoch;
            header.simulcast_layer = frame.layer.map(|l| l as u8).unwrap_or(0);

            let mut header_buf = BytesMut::with_capacity(HEADER_SIZE);
            header.encode(&mut header_buf);
            let header_bytes: [u8; HEADER_SIZE] = header_buf[..HEADER_SIZE]
                .try_into()
                .expect("header is 16 bytes");

            let encrypted = session
                .frame_encryptor
                .encrypt(&header_bytes, ssrc, session.key_epoch, *seq, &frame.data)
                .map_err(|e| format!("video encrypt: {e:?}"))?;

            header.payload_length = encrypted.len() as u16;

            let mut buf = BytesMut::with_capacity(HEADER_SIZE + encrypted.len());
            header.encode(&mut buf);
            buf.put_slice(&encrypted);

            if let Err(e) = session.connection.send_datagram(buf.freeze()) {
                return Err(format!("video datagram send: {e}"));
            }

            *seq = seq.wrapping_add(1);
        }

        Ok(())
    }

    #[cfg(not(feature = "vpx"))]
    {
        let _ = (session, rgba_data, is_screen);
        Err("video encoding requires the 'vpx' feature".into())
    }
}

/// Handle an incoming video datagram: decrypt → decode → emit Tauri event.
pub fn handle_video_datagram(
    header: &MediaHeader,
    decrypted_payload: &[u8],
    app: &tauri::AppHandle,
) {
    #[cfg(feature = "vpx")]
    {
        use paracord_codec::video::EncodedFrame;

        // Build an EncodedFrame for a per-SSRC decoder (to be maintained in session).
        let _encoded = EncodedFrame {
            data: decrypted_payload.to_vec(),
            pts: header.timestamp as i64,
            is_keyframe: header.sequence == 0,
            layer: None,
            width: 0,
            height: 0,
        };

        // TODO: maintain per-SSRC decoder map and emit decoded RGBA frames via Tauri events.
        // For now this is a no-op until decoder management is added.
        let _ = app;
    }

    #[cfg(not(feature = "vpx"))]
    {
        let _ = (header, decrypted_payload, app);
    }
}
