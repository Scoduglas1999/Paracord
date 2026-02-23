import type { MediaEngine, ScreenShareConfig } from './mediaEngine';

// Tauri API imports - these resolve at runtime in the Tauri environment
let invoke: (cmd: string, args?: Record<string, unknown> | ArrayBuffer | Uint8Array) => Promise<unknown>;
let listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;

// Dynamic import to avoid bundling issues in browser builds
const tauriReady = (async () => {
  try {
    const core = await import('@tauri-apps/api/core');
    const event = await import('@tauri-apps/api/event');
    invoke = core.invoke;
    listen = event.listen;
  } catch {
    // Not in Tauri environment
  }
})();

type UnlistenFn = () => void;

function normalizeNativeRelayEndpoint(endpoint: string): string {
  if (!endpoint) return '';
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    const port =
      parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '');
    if (!host || !port) return trimmed;
    if (host.includes(':') && !host.startsWith('[')) {
      return `[${host}]:${port}`;
    }
    return `${host}:${port}`;
  } catch {
    return trimmed;
  }
}

/**
 * Tauri desktop media engine.
 * Communicates with the Rust native media engine via Tauri IPC commands.
 * The native side handles QUIC transport, Opus encoding, and P2P connections.
 */
export class TauriMediaEngine implements MediaEngine {
  private unlisteners: UnlistenFn[] = [];

  // Screen share state — uses getDisplayMedia in the WebView for capture
  private screenStream: MediaStream | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenShareEndedCb: (() => void) | null = null;
  private screenAudioAccumulator: number[] = [];
  private screenAudioActive = false;

  // Video frame extraction
  private videoStream: MediaStream | null = null;
  private videoFrameLoop: number | null = null;
  private screenFrameLoop: number | null = null;
  private videoSendInFlight = false;
  private screenSendInFlight = false;

  async connect(endpoint: string, token: string, _certHash?: string): Promise<void> {
    await tauriReady;
    const relayEndpoint = normalizeNativeRelayEndpoint(endpoint);
    try {
      await invoke('start_voice_session', { endpoint: relayEndpoint, token, roomId: '' });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `native session start failed (relay=${relayEndpoint}, source=${endpoint}): ${reason}`
      );
    }
  }

  async disconnect(): Promise<void> {
    await tauriReady;
    this.stopFrameExtraction();
    this.cleanupScreenShare();
    this.screenAudioActive = false;
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    await invoke('stop_voice_session');
  }

  setMute(muted: boolean): void {
    invoke('voice_set_mute', { muted });
  }

  setDeaf(deafened: boolean): void {
    invoke('voice_set_deaf', { deafened });
  }

  enableVideo(enabled: boolean): void {
    if (enabled) {
      // Capture camera in WebView, extract RGBA frames, send to Rust for VP9 encoding
      navigator.mediaDevices
        .getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } } })
        .then((stream) => {
          this.videoStream = stream;
          invoke('voice_enable_video', { enabled: true });
          this.startVideoFrameExtraction(stream, false);
        })
        .catch((err) => {
          console.error('[TauriMediaEngine] camera capture failed:', err);
        });
    } else {
      this.stopVideoCapture();
      invoke('voice_enable_video', { enabled: false });
    }
  }

  async startScreenShare(config: ScreenShareConfig): Promise<void> {
    await tauriReady;

    if (!invoke) {
      throw new Error('Tauri IPC not available — cannot start screen share');
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('getDisplayMedia API not available in this WebView. Screen sharing requires WebView2 v93+.');
    }

    this.cleanupScreenShare();
    this.screenAudioActive = false;

    const targetFps = config.maxFrameRate ?? 30;

    const constraints: DisplayMediaStreamOptions = {
      video: {
        frameRate: { ideal: targetFps, max: targetFps },
      },
      // Desktop QUIC streaming uses the native system-audio capture path.
      // Keep getDisplayMedia focused on video capture only.
      audio: false,
    };

    this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);

    const videoTracks = this.screenStream.getVideoTracks();
    if (videoTracks.length === 0) {
      this.screenStream = null;
      throw new Error('No video track in screen share stream');
    }

    this.screenTrack = videoTracks[0];

    this.screenTrack.addEventListener('ended', () => {
      this.cleanupScreenShare();
      this.screenAudioActive = false;
      this.screenShareEndedCb?.();
    });

    await invoke('voice_start_screen_share');
    if (config.audio) {
      const audioForwardingReady = await this.startScreenAudioForwarding();
      if (!audioForwardingReady) {
        console.warn('[TauriMediaEngine] Native system audio capture unavailable; streaming video-only.');
      }
      this.screenAudioActive = audioForwardingReady;
    } else {
      await invoke('voice_set_screen_audio_enabled', { enabled: false }).catch(() => { });
      this.screenAudioActive = false;
    }

    // Start frame extraction loop for screen share
    this.startVideoFrameExtraction(this.screenStream, true);
  }

  stopScreenShare(): void {
    if (this.screenFrameLoop !== null) {
      cancelAnimationFrame(this.screenFrameLoop);
      this.screenFrameLoop = null;
    }
    this.cleanupScreenShare();
    this.screenAudioActive = false;
    invoke('voice_stop_screen_share');
  }

  getLocalScreenShareTrack(): MediaStreamTrack | null {
    return this.screenTrack;
  }

  isScreenShareAudioActive(): boolean {
    return this.screenAudioActive;
  }

  onScreenShareEnded(cb: () => void): void {
    this.screenShareEndedCb = cb;
  }

  private cleanupScreenShare(): void {
    if (this.screenFrameLoop !== null) {
      cancelAnimationFrame(this.screenFrameLoop);
      this.screenFrameLoop = null;
    }
    if (this.screenTrack) {
      this.screenTrack.stop();
      this.screenTrack = null;
    }
    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        track.stop();
      }
      this.screenStream = null;
    }

    this.stopScreenAudioForwarding();
  }

  private async startScreenAudioForwarding(): Promise<boolean> {
    this.stopScreenAudioForwarding();

    try {
      const { Channel } = await import('@tauri-apps/api/core');

      // Enable and reset any stale capture session
      await invoke('set_system_audio_capture_enabled', { enabled: true });
      await invoke('stop_system_audio_capture').catch(() => {});

      this.screenAudioAccumulator = [];

      // Receive audio chunks directly from Rust WASAPI capture via Tauri Channel,
      // bypassing AudioWorklet (which WebView2 blocks due to blob URL CSP).
      const channel = new Channel<{ samples: number[]; sample_rate: number }>();
      channel.onmessage = (msg) => {
        // Rust sends interleaved stereo (L, R, L, R, ...) — downmix to mono
        const stereo = msg.samples;
        for (let i = 0; i < stereo.length; i += 2) {
          const l = stereo[i] ?? 0;
          const r = stereo[i + 1] ?? 0;
          this.screenAudioAccumulator.push((l + r) / 2);
        }

        // Flush 960-sample (20ms @ 48kHz) mono frames to Rust for Opus encoding
        while (this.screenAudioAccumulator.length >= 960) {
          const frame = this.screenAudioAccumulator.splice(0, 960);
          invoke('voice_push_screen_audio_frame', { samples: frame }).catch(() => {});
        }
      };

      try {
        await invoke('start_system_audio_capture', { onAudio: channel });
      } catch (startErr) {
        // Retry once for "already running" races from overlapping stop/start
        const errMsg = startErr instanceof Error ? startErr.message : String(startErr);
        if (!errMsg.toLowerCase().includes('already running')) {
          throw startErr;
        }
        await invoke('stop_system_audio_capture').catch(() => {});
        await invoke('start_system_audio_capture', { onAudio: channel });
      }

      await invoke('voice_set_screen_audio_enabled', { enabled: true }).catch(() => {});
      this.screenAudioActive = true;
      console.info('[TauriMediaEngine] Native system audio capture started (direct channel)');
      return true;
    } catch (err) {
      console.warn('[TauriMediaEngine] Failed to start screen audio forwarding:', err);
      this.stopScreenAudioForwarding();
      return false;
    }
  }

  private stopScreenAudioForwarding(): void {
    this.screenAudioAccumulator = [];
    this.screenAudioActive = false;
    if (!invoke) return;
    invoke('stop_system_audio_capture').catch(() => {});
    invoke('set_system_audio_capture_enabled', { enabled: false }).catch(() => {});
    invoke('voice_set_screen_audio_enabled', { enabled: false }).catch(() => {});
  }

  private stopVideoCapture(): void {
    if (this.videoFrameLoop !== null) {
      cancelAnimationFrame(this.videoFrameLoop);
      this.videoFrameLoop = null;
    }
    if (this.videoStream) {
      for (const track of this.videoStream.getTracks()) {
        track.stop();
      }
      this.videoStream = null;
    }
  }

  private stopFrameExtraction(): void {
    this.stopVideoCapture();
    if (this.screenFrameLoop !== null) {
      cancelAnimationFrame(this.screenFrameLoop);
      this.screenFrameLoop = null;
    }
  }

  /**
   * Extract RGBA frames from a MediaStream and push them to the Rust side
   * for VP9 encoding and QUIC transport.
   */
  private startVideoFrameExtraction(stream: MediaStream, isScreen: boolean): void {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    const settings = videoTrack.getSettings();
    const width = settings.width ?? 640;
    const height = settings.height ?? 360;

    // Use OffscreenCanvas to extract RGBA pixel data
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a video element to render the stream
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.play();

    const command = isScreen ? 'voice_push_screen_frame' : 'voice_push_video_frame';
    const targetInterval = 1000 / (isScreen ? 15 : 30); // fps
    let lastFrameTime = 0;

    const extractFrame = (now: number) => {
      if (now - lastFrameTime < targetInterval) {
        const loopId = requestAnimationFrame(extractFrame);
        if (isScreen) {
          this.screenFrameLoop = loopId;
        } else {
          this.videoFrameLoop = loopId;
        }
        return;
      }
      lastFrameTime = now;

      // Drop frame if previous send hasn't completed (backpressure)
      const inFlight = isScreen ? this.screenSendInFlight : this.videoSendInFlight;

      if (!inFlight && video.readyState >= video.HAVE_CURRENT_DATA) {
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const rgba = new Uint8Array(imageData.data.buffer);

        // Pack width(u32 LE) + height(u32 LE) + RGBA bytes into a single
        // binary buffer.  Tauri v2 sends Uint8Array as
        // application/octet-stream — no JSON serialisation overhead.
        const payload = new Uint8Array(8 + rgba.byteLength);
        const header = new DataView(payload.buffer);
        header.setUint32(0, width, true);
        header.setUint32(4, height, true);
        payload.set(rgba, 8);

        if (isScreen) { this.screenSendInFlight = true; } else { this.videoSendInFlight = true; }
        invoke(command, payload)
          .catch(() => { /* VP9 feature may not be enabled; silently skip */ })
          .finally(() => {
            if (isScreen) { this.screenSendInFlight = false; } else { this.videoSendInFlight = false; }
          });
      }

      const loopId = requestAnimationFrame(extractFrame);
      if (isScreen) {
        this.screenFrameLoop = loopId;
      } else {
        this.videoFrameLoop = loopId;
      }
    };

    const loopId = requestAnimationFrame(extractFrame);
    if (isScreen) {
      this.screenFrameLoop = loopId;
    } else {
      this.videoFrameLoop = loopId;
    }
  }

  onSpeakingChange(cb: (speakers: Map<string, number>) => void): void {
    tauriReady.then(async () => {
      const unlisten = await listen('media_speaking_change', (event) => {
        const payload = event.payload as Record<string, number>;
        const speakers = new Map(Object.entries(payload));
        cb(speakers);
      });
      this.unlisteners.push(unlisten);
    });
  }

  onParticipantJoin(cb: (userId: string) => void): void {
    tauriReady.then(async () => {
      const unlisten = await listen('media_participant_join', (event) => {
        cb(event.payload as string);
      });
      this.unlisteners.push(unlisten);
    });
  }

  onParticipantLeave(cb: (userId: string) => void): void {
    tauriReady.then(async () => {
      const unlisten = await listen('media_participant_leave', (event) => {
        cb(event.payload as string);
      });
      this.unlisteners.push(unlisten);
    });
  }

  subscribeVideo(userId: string, canvas: HTMLCanvasElement): void {
    invoke('media_subscribe_video', {
      userId,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    }).then(async () => {
      const unlisten = await listen(`media_video_frame_${userId}`, (event) => {
        const frame = event.payload as { width: number; height: number; data: number[] };
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const imageData = new ImageData(
          new Uint8ClampedArray(frame.data),
          frame.width,
          frame.height,
        );
        ctx.putImageData(imageData, 0, 0);
      });
      this.unlisteners.push(unlisten);
    });
  }
}

