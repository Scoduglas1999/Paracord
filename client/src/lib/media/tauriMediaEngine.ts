import type { MediaEngine, ScreenShareConfig } from './mediaEngine';

// Tauri API imports - these resolve at runtime in the Tauri environment
let invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
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

  // Video frame extraction
  private videoStream: MediaStream | null = null;
  private videoFrameLoop: number | null = null;
  private screenFrameLoop: number | null = null;

  async connect(endpoint: string, token: string, _certHash?: string): Promise<void> {
    await tauriReady;
    await invoke('start_voice_session', { endpoint, token, roomId: '' });
  }

  async disconnect(): Promise<void> {
    await tauriReady;
    this.stopFrameExtraction();
    this.cleanupScreenShare();
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

    this.cleanupScreenShare();

    const targetFps = config.maxFrameRate ?? 30;

    const constraints: DisplayMediaStreamOptions = {
      video: {
        frameRate: { ideal: targetFps, max: targetFps },
      },
      audio: config.audio,
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
      this.screenShareEndedCb?.();
    });

    await invoke('voice_start_screen_share');

    // Start frame extraction loop for screen share
    this.startVideoFrameExtraction(this.screenStream, true);
  }

  stopScreenShare(): void {
    if (this.screenFrameLoop !== null) {
      cancelAnimationFrame(this.screenFrameLoop);
      this.screenFrameLoop = null;
    }
    this.cleanupScreenShare();
    invoke('voice_stop_screen_share');
  }

  getLocalScreenShareTrack(): MediaStreamTrack | null {
    return this.screenTrack;
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

      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        // Send RGBA bytes to Rust for encoding
        invoke(command, {
          width,
          height,
          data: Array.from(imageData.data),
        }).catch(() => {
          // VP9 feature may not be enabled; silently skip
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
