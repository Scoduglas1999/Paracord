//! Video encoding and decoding pipeline with simulcast support.
//!
//! This module provides a trait-based abstraction for video codecs,
//! with a concrete VP9 implementation gated behind the `vpx` feature flag.
//!
//! # Architecture
//!
//! - [`VideoEncoder`] / [`VideoDecoder`] traits define the codec interface.
//! - [`SimulcastEncoder`] wraps multiple encoder instances for simultaneous
//!   multi-quality encoding (low / medium / high).
//! - [`Vp9Encoder`] / [`Vp9Decoder`] provide the VP9 implementation (requires `vpx` feature).
//! - [`NullEncoder`] / [`NullDecoder`] provide a zero-dependency test/stub implementation.
//!
//! # Simulcast Layers
//!
//! Three quality tiers are defined:
//!
//! | Layer  | Resolution | FPS | Target Bitrate |
//! |--------|-----------|-----|----------------|
//! | Low    | 320x180   | 15  | 150 kbps       |
//! | Medium | 640x360   | 30  | 500 kbps       |
//! | High   | 1280x720  | 30  | 1500 kbps      |

pub mod decoder;
pub mod encoder;

use serde::{Deserialize, Serialize};
use thiserror::Error;

// ── Error types ──────────────────────────────────────────────────────

/// Errors produced by video encoding or decoding operations.
#[derive(Debug, Error)]
pub enum VideoError {
    #[error("encoder initialization failed: {0}")]
    EncoderInit(String),

    #[error("decoder initialization failed: {0}")]
    DecoderInit(String),

    #[error("encoding failed: {0}")]
    EncodeFailed(String),

    #[error("decoding failed: {0}")]
    DecodeFailed(String),

    #[error("invalid frame dimensions: {width}x{height} (must be even and positive)")]
    InvalidDimensions { width: u32, height: u32 },

    #[error("frame data size mismatch: expected {expected} bytes, got {actual}")]
    FrameSizeMismatch { expected: usize, actual: usize },

    #[error("unsupported pixel format: {0:?}")]
    UnsupportedPixelFormat(PixelFormat),

    #[error("keyframe required but not available")]
    KeyframeRequired,

    #[error("codec not available: {0}")]
    CodecUnavailable(String),
}

// ── Pixel format ─────────────────────────────────────────────────────

/// Pixel format for raw video frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PixelFormat {
    /// Planar YUV 4:2:0 — the native format for VP9.
    /// Layout: Y plane (w*h), U plane (w/2 * h/2), V plane (w/2 * h/2).
    I420,
    /// Packed RGBA (4 bytes per pixel). Convenient for desktop capture.
    Rgba,
}

impl PixelFormat {
    /// Calculate the expected byte size for a frame at the given resolution.
    pub fn frame_size(self, width: u32, height: u32) -> usize {
        match self {
            PixelFormat::I420 => {
                let y = (width * height) as usize;
                let uv = ((width / 2) * (height / 2)) as usize;
                y + 2 * uv
            }
            PixelFormat::Rgba => (width * height * 4) as usize,
        }
    }
}

// ── Simulcast layer definitions ──────────────────────────────────────

/// Identifies a simulcast quality tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SimulcastLayer {
    /// 320x180 @ 15 fps, ~150 kbps
    Low,
    /// 640x360 @ 30 fps, ~500 kbps
    Medium,
    /// 1280x720 @ 30 fps, ~1500 kbps
    High,
}

impl SimulcastLayer {
    /// Resolution (width, height) for this layer.
    pub fn resolution(self) -> (u32, u32) {
        match self {
            SimulcastLayer::Low => (320, 180),
            SimulcastLayer::Medium => (640, 360),
            SimulcastLayer::High => (1280, 720),
        }
    }

    /// Target frame rate for this layer.
    pub fn fps(self) -> u32 {
        match self {
            SimulcastLayer::Low => 15,
            SimulcastLayer::Medium => 30,
            SimulcastLayer::High => 30,
        }
    }

    /// Target bitrate in kilobits per second.
    pub fn bitrate_kbps(self) -> u32 {
        match self {
            SimulcastLayer::Low => 150,
            SimulcastLayer::Medium => 500,
            SimulcastLayer::High => 1500,
        }
    }

    /// All layers from lowest to highest quality.
    pub fn all() -> &'static [SimulcastLayer] {
        &[
            SimulcastLayer::Low,
            SimulcastLayer::Medium,
            SimulcastLayer::High,
        ]
    }
}

// ── Encoder configuration ────────────────────────────────────────────

/// Configuration for creating a video encoder instance.
#[derive(Debug, Clone)]
pub struct EncoderConfig {
    /// Frame width in pixels (must be even).
    pub width: u32,
    /// Frame height in pixels (must be even).
    pub height: u32,
    /// Target frames per second.
    pub fps: u32,
    /// Target bitrate in kilobits per second.
    pub bitrate_kbps: u32,
    /// Input pixel format.
    pub pixel_format: PixelFormat,
    /// Keyframe interval in frames (0 = codec default).
    pub keyframe_interval: u32,
}

impl EncoderConfig {
    /// Create an `EncoderConfig` matching a simulcast layer definition.
    pub fn for_layer(layer: SimulcastLayer, pixel_format: PixelFormat) -> Self {
        let (width, height) = layer.resolution();
        Self {
            width,
            height,
            fps: layer.fps(),
            bitrate_kbps: layer.bitrate_kbps(),
            pixel_format,
            keyframe_interval: 0,
        }
    }

    /// Validate that width and height are even and positive.
    pub fn validate(&self) -> Result<(), VideoError> {
        if self.width == 0 || self.height == 0 || self.width % 2 != 0 || self.height % 2 != 0 {
            return Err(VideoError::InvalidDimensions {
                width: self.width,
                height: self.height,
            });
        }
        Ok(())
    }
}

// ── Decoder configuration ────────────────────────────────────────────

/// Configuration for creating a video decoder instance.
#[derive(Debug, Clone)]
pub struct DecoderConfig {
    /// Output pixel format.
    pub pixel_format: PixelFormat,
}

impl Default for DecoderConfig {
    fn default() -> Self {
        Self {
            pixel_format: PixelFormat::I420,
        }
    }
}

// ── Encoded / decoded frame types ────────────────────────────────────

/// An encoded video frame produced by a [`VideoEncoder`].
#[derive(Debug, Clone)]
pub struct EncodedFrame {
    /// The compressed frame data.
    pub data: Vec<u8>,
    /// Presentation timestamp (units depend on encoder timebase).
    pub pts: i64,
    /// Whether this frame is a keyframe (IDR / intra).
    pub is_keyframe: bool,
    /// Which simulcast layer produced this frame, if applicable.
    pub layer: Option<SimulcastLayer>,
    /// Frame width.
    pub width: u32,
    /// Frame height.
    pub height: u32,
}

/// A decoded video frame produced by a [`VideoDecoder`].
#[derive(Debug, Clone)]
pub struct DecodedFrame {
    /// Raw pixel data in the format indicated by `pixel_format`.
    pub data: Vec<u8>,
    /// Pixel format of the data buffer.
    pub pixel_format: PixelFormat,
    /// Frame width.
    pub width: u32,
    /// Frame height.
    pub height: u32,
    /// Presentation timestamp forwarded from the encoded frame.
    pub pts: i64,
}

// ── Color-space conversion helpers ───────────────────────────────────

/// Convert an RGBA frame to I420 (YUV 4:2:0) in-place.
///
/// Both buffers must be pre-allocated to the correct sizes.
pub fn rgba_to_i420(rgba: &[u8], width: u32, height: u32, i420: &mut [u8]) {
    let w = width as usize;
    let h = height as usize;
    let y_size = w * h;
    let uv_w = w / 2;
    let uv_h = h / 2;

    let (y_plane, uv_planes) = i420.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_w * uv_h);

    // Compute Y plane
    for row in 0..h {
        for col in 0..w {
            let idx = (row * w + col) * 4;
            let r = rgba[idx] as f32;
            let g = rgba[idx + 1] as f32;
            let b = rgba[idx + 2] as f32;
            let y = (0.257 * r + 0.504 * g + 0.098 * b + 16.0).clamp(0.0, 255.0);
            y_plane[row * w + col] = y as u8;
        }
    }

    // Compute U and V planes (subsampled 2x2)
    for row in 0..uv_h {
        for col in 0..uv_w {
            // Average the 2x2 block
            let mut r_sum = 0.0f32;
            let mut g_sum = 0.0f32;
            let mut b_sum = 0.0f32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let px = ((row * 2 + dy) * w + col * 2 + dx) * 4;
                    r_sum += rgba[px] as f32;
                    g_sum += rgba[px + 1] as f32;
                    b_sum += rgba[px + 2] as f32;
                }
            }
            let r = r_sum / 4.0;
            let g = g_sum / 4.0;
            let b = b_sum / 4.0;

            let u = (-0.148 * r - 0.291 * g + 0.439 * b + 128.0).clamp(0.0, 255.0);
            let v = (0.439 * r - 0.368 * g - 0.071 * b + 128.0).clamp(0.0, 255.0);

            u_plane[row * uv_w + col] = u as u8;
            v_plane[row * uv_w + col] = v as u8;
        }
    }
}

/// Convert an I420 (YUV 4:2:0) frame to RGBA.
///
/// Both buffers must be pre-allocated to the correct sizes.
pub fn i420_to_rgba(i420: &[u8], width: u32, height: u32, rgba: &mut [u8]) {
    let w = width as usize;
    let h = height as usize;
    let y_size = w * h;
    let uv_w = w / 2;
    let uv_h = h / 2;
    let uv_size = uv_w * uv_h;

    let y_plane = &i420[..y_size];
    let u_plane = &i420[y_size..y_size + uv_size];
    let v_plane = &i420[y_size + uv_size..];

    for row in 0..h {
        for col in 0..w {
            let y = y_plane[row * w + col] as f32;
            let u = u_plane[(row / 2) * uv_w + col / 2] as f32;
            let v = v_plane[(row / 2) * uv_w + col / 2] as f32;

            let c = y - 16.0;
            let d = u - 128.0;
            let e = v - 128.0;

            let r = (1.164 * c + 1.596 * e).clamp(0.0, 255.0);
            let g = (1.164 * c - 0.392 * d - 0.813 * e).clamp(0.0, 255.0);
            let b = (1.164 * c + 2.017 * d).clamp(0.0, 255.0);

            let out_idx = (row * w + col) * 4;
            rgba[out_idx] = r as u8;
            rgba[out_idx + 1] = g as u8;
            rgba[out_idx + 2] = b as u8;
            rgba[out_idx + 3] = 255; // full alpha
        }
    }
}

/// Naively downscale an I420 frame to a target resolution using nearest-neighbor.
///
/// This is intentionally simple; a production pipeline would use a proper
/// scaler (e.g. libyuv or lanczos). For simulcast we need quick downscaling
/// to feed multiple encoder instances.
pub fn downscale_i420(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let sw = src_w as usize;
    let sh = src_h as usize;
    let dw = dst_w as usize;
    let dh = dst_h as usize;

    let src_y_size = sw * sh;
    let src_uv_w = sw / 2;
    let src_uv_h = sh / 2;
    let src_uv_size = src_uv_w * src_uv_h;

    let dst_y_size = dw * dh;
    let dst_uv_w = dw / 2;
    let dst_uv_h = dh / 2;
    let dst_uv_size = dst_uv_w * dst_uv_h;

    let mut dst = vec![0u8; dst_y_size + 2 * dst_uv_size];

    let src_y = &src[..src_y_size];
    let src_u = &src[src_y_size..src_y_size + src_uv_size];
    let src_v = &src[src_y_size + src_uv_size..];

    let (dst_y, dst_uv) = dst.split_at_mut(dst_y_size);
    let (dst_u, dst_v) = dst_uv.split_at_mut(dst_uv_size);

    // Nearest-neighbor Y
    for row in 0..dh {
        let src_row = row * sh / dh;
        for col in 0..dw {
            let src_col = col * sw / dw;
            dst_y[row * dw + col] = src_y[src_row * sw + src_col];
        }
    }

    // Nearest-neighbor U and V
    for row in 0..dst_uv_h {
        let src_row = row * src_uv_h / dst_uv_h;
        for col in 0..dst_uv_w {
            let src_col = col * src_uv_w / dst_uv_w;
            dst_u[row * dst_uv_w + col] = src_u[src_row * src_uv_w + src_col];
            dst_v[row * dst_uv_w + col] = src_v[src_row * src_uv_w + src_col];
        }
    }

    dst
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixel_format_frame_sizes() {
        assert_eq!(PixelFormat::I420.frame_size(320, 180), 320 * 180 * 3 / 2);
        assert_eq!(PixelFormat::Rgba.frame_size(320, 180), 320 * 180 * 4);
        assert_eq!(PixelFormat::I420.frame_size(1280, 720), 1280 * 720 * 3 / 2);
    }

    #[test]
    fn simulcast_layer_properties() {
        assert_eq!(SimulcastLayer::Low.resolution(), (320, 180));
        assert_eq!(SimulcastLayer::Medium.resolution(), (640, 360));
        assert_eq!(SimulcastLayer::High.resolution(), (1280, 720));

        assert_eq!(SimulcastLayer::Low.fps(), 15);
        assert_eq!(SimulcastLayer::Medium.fps(), 30);
        assert_eq!(SimulcastLayer::High.fps(), 30);
    }

    #[test]
    fn encoder_config_validation() {
        let good = EncoderConfig::for_layer(SimulcastLayer::Low, PixelFormat::I420);
        assert!(good.validate().is_ok());

        let bad = EncoderConfig {
            width: 321,
            height: 180,
            fps: 30,
            bitrate_kbps: 500,
            pixel_format: PixelFormat::I420,
            keyframe_interval: 0,
        };
        assert!(bad.validate().is_err());

        let zero = EncoderConfig {
            width: 0,
            height: 0,
            fps: 30,
            bitrate_kbps: 500,
            pixel_format: PixelFormat::I420,
            keyframe_interval: 0,
        };
        assert!(zero.validate().is_err());
    }

    #[test]
    fn rgba_i420_round_trip() {
        let w: u32 = 8;
        let h: u32 = 8;

        // Create a red RGBA frame
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[0] = 200; // R
            pixel[1] = 50; // G
            pixel[2] = 30; // B
            pixel[3] = 255; // A
        }

        // Convert to I420
        let i420_size = PixelFormat::I420.frame_size(w, h);
        let mut i420 = vec![0u8; i420_size];
        rgba_to_i420(&rgba, w, h, &mut i420);

        // Convert back to RGBA
        let mut rgba2 = vec![0u8; (w * h * 4) as usize];
        i420_to_rgba(&i420, w, h, &mut rgba2);

        // Check that the round-tripped values are close (lossy conversion)
        for pixel in rgba2.chunks_exact(4) {
            // Allow +/- 5 due to rounding in YUV conversion
            assert!(
                (pixel[0] as i16 - 200).unsigned_abs() <= 5,
                "R channel off: {}",
                pixel[0]
            );
            assert!(
                (pixel[1] as i16 - 50).unsigned_abs() <= 5,
                "G channel off: {}",
                pixel[1]
            );
            assert!(
                (pixel[2] as i16 - 30).unsigned_abs() <= 5,
                "B channel off: {}",
                pixel[2]
            );
            assert_eq!(pixel[3], 255, "Alpha must be preserved");
        }
    }

    #[test]
    fn downscale_i420_basic() {
        let src_w: u32 = 8;
        let src_h: u32 = 8;
        let dst_w: u32 = 4;
        let dst_h: u32 = 4;

        let src_size = PixelFormat::I420.frame_size(src_w, src_h);
        let dst_size = PixelFormat::I420.frame_size(dst_w, dst_h);

        // Fill with a known pattern: Y=128, U=64, V=192
        let mut src = vec![0u8; src_size];
        let y_size = (src_w * src_h) as usize;
        let uv_size = ((src_w / 2) * (src_h / 2)) as usize;
        src[..y_size].fill(128);
        src[y_size..y_size + uv_size].fill(64);
        src[y_size + uv_size..].fill(192);

        let dst = downscale_i420(&src, src_w, src_h, dst_w, dst_h);
        assert_eq!(dst.len(), dst_size);

        let dy = (dst_w * dst_h) as usize;
        let duv = ((dst_w / 2) * (dst_h / 2)) as usize;
        // Uniform input should produce uniform output
        assert!(dst[..dy].iter().all(|&v| v == 128));
        assert!(dst[dy..dy + duv].iter().all(|&v| v == 64));
        assert!(dst[dy + duv..].iter().all(|&v| v == 192));
    }
}
