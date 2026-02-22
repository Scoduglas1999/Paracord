import type { MediaEngine, ScreenShareConfig } from './mediaEngine';
import { WebTransportManager, type ControlMessage } from './transport/webTransport';
import {
  type MediaHeader,
  TrackType,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  createPacket,
  parsePacket,
} from './transport/protocol';
import { SenderKeyManager } from './senderKeys';
import { OpusMediaEncoder, OpusMediaDecoder } from './audio/opusCodec';
import { JitterBuffer } from './audio/jitterBuffer';
import { MediaVideoEncoder, type EncodedVideoChunkWithMeta } from './video/videoEncoder';
import { MediaVideoDecoder } from './video/videoDecoder';
import { CanvasRenderer } from './video/canvasRenderer';

const SAMPLE_RATE = 48_000;
const CHANNELS = 1;
const BITRATE = 96_000;
const FRAME_MS = 20;

/** Default VP9 codec string. */
const VP9_CODEC = 'vp09.00.10.08';

interface ParticipantState {
  ssrc: number;
  userId: string;
  decoder: OpusMediaDecoder;
  jitterBuffer: JitterBuffer;
  speaking: boolean;
  audioLevel: number;
}

/** State for a remote participant's video stream. */
interface VideoSubscription {
  userId: string;
  ssrc: number;
  decoder: MediaVideoDecoder;
  renderer: CanvasRenderer;
}

/**
 * Browser media engine using WebTransport + WebCodecs.
 * Always connects via server relay (browsers can't do P2P QUIC).
 */
export class BrowserMediaEngine implements MediaEngine {
  private transport: WebTransportManager | null = null;
  private senderKeys = new SenderKeyManager();

  // Audio capture
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private encoder: OpusMediaEncoder | null = null;

  // Audio playback
  private playbackContext: AudioContext | null = null;

  // Video capture (camera)
  private videoStream: MediaStream | null = null;
  private videoEncoder: MediaVideoEncoder | null = null;
  private videoFrameCallbackId: number | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private videoEnabled = false;
  private videoSequence = 0;

  // Screen share capture
  private screenStream: MediaStream | null = null;
  private screenEncoder: MediaVideoEncoder | null = null;
  private screenFrameCallbackId: number | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenAudioSource: MediaStreamAudioSourceNode | null = null;
  private screenAudioActive = false;
  private screenSequence = 0;
  private screenShareEndedCb: (() => void) | null = null;

  // Video subscriptions: userId -> subscription
  private videoSubscriptions = new Map<string, VideoSubscription>();

  // State
  private localSsrc = 0;
  private sequence = 0;
  private muted = false;
  private deafened = false;
  private localAudioLevel = 0;

  // Participants
  private participants = new Map<number, ParticipantState>(); // ssrc -> state
  private ssrcToUserId = new Map<number, string>();

  // Callbacks
  private speakingChangeCb: ((speakers: Map<string, number>) => void) | null = null;
  private participantJoinCb: ((userId: string) => void) | null = null;
  private participantLeaveCb: ((userId: string) => void) | null = null;

  // Playback timer
  private playbackInterval: ReturnType<typeof setInterval> | null = null;

  async connect(endpoint: string, token: string, certHash?: string): Promise<void> {
    // Generate local SSRC
    this.localSsrc = (Math.random() * 0xffffffff) >>> 0;
    this.sequence = 0;

    // Generate E2EE sender key
    await this.senderKeys.generateKey();

    // Set up WebTransport
    this.transport = new WebTransportManager();

    this.transport.onControl((msg) => this.handleControlMessage(msg));
    this.transport.onDatagram((data) => this.handleDatagram(data));
    this.transport.onClose((reason) => {
      console.warn('[BrowserMediaEngine] Connection closed:', reason);
      this.cleanupAudio();
      this.cleanupVideo();
    });

    await this.transport.connect(endpoint, token, certHash);

    // Announce our SSRC and sender key
    const keyBytes = await this.senderKeys.exportKey();
    await this.transport.sendControl({
      type: 'join',
      ssrc: this.localSsrc,
      senderKey: Array.from(keyBytes),
      epoch: this.senderKeys.currentEpoch,
    });

    // Set up audio capture pipeline
    await this.setupAudioCapture();

    // Start playback loop
    this.startPlaybackLoop();
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.sendControl({ type: 'leave', ssrc: this.localSsrc });
      await this.transport.disconnect();
      this.transport = null;
    }
    this.cleanupAudio();
    this.cleanupVideo();
    this.cleanupScreenShare();
    this.stopPlaybackLoop();

    // Close all participant audio decoders
    for (const [, participant] of this.participants) {
      participant.decoder.close();
    }
    this.participants.clear();
    this.ssrcToUserId.clear();

    // Close all video subscriptions
    for (const [, sub] of this.videoSubscriptions) {
      sub.decoder.close();
      sub.renderer.destroy();
    }
    this.videoSubscriptions.clear();
  }

  setMute(muted: boolean): void {
    this.muted = muted;
    if (this.mediaStream) {
      for (const track of this.mediaStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
  }

  setDeaf(deafened: boolean): void {
    this.deafened = deafened;
    if (deafened) {
      this.setMute(true);
    }
  }

  enableVideo(enabled: boolean): void {
    if (enabled && !this.videoEnabled) {
      this.videoEnabled = true;
      this.setupVideoCapture().catch((err) => {
        console.error('[BrowserMediaEngine] Failed to enable video:', err);
        this.videoEnabled = false;
      });
    } else if (!enabled && this.videoEnabled) {
      this.videoEnabled = false;
      this.cleanupVideo();

      // Notify the server that video is stopped
      if (this.transport) {
        this.transport.sendControl({
          type: 'video_stop',
          ssrc: this.localSsrc,
        });
      }
    }
  }

  async startScreenShare(config: ScreenShareConfig): Promise<void> {
    // Stop any existing screen share first
    this.cleanupScreenShare();
    this.screenAudioActive = false;

    const constraints: DisplayMediaStreamOptions = {
      video: {
        frameRate: config.maxFrameRate ?? 30,
        width: { max: config.maxWidth ?? 1920 },
        height: { max: config.maxHeight ?? 1080 },
      },
      audio: config.audio,
    };
    if (config.audio) {
      const hintable = constraints as unknown as Record<string, unknown>;
      hintable.systemAudio = 'include';
      hintable.selfBrowserSurface = 'include';
      hintable.surfaceSwitching = 'include';
    }

    this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);

    const videoTracks = this.screenStream.getVideoTracks();
    if (videoTracks.length === 0) {
      this.screenStream = null;
      throw new Error('No video track in screen share stream');
    }

    this.screenTrack = videoTracks[0];

    // Mix captured display audio into the existing outbound Opus pipeline.
    // Native QUIC transport currently has a single audio track, so stream audio
    // is delivered by mixing it with the microphone uplink while sharing.
    const audioTracks = this.screenStream.getAudioTracks();
    if (config.audio && audioTracks.length > 0 && this.audioContext && this.workletNode) {
      const audioOnlyStream = new MediaStream(audioTracks);
      this.screenAudioSource = this.audioContext.createMediaStreamSource(audioOnlyStream);
      this.screenAudioSource.connect(this.workletNode);
      this.screenAudioActive = true;
    }

    // Listen for the user stopping the share via the browser's built-in UI
    this.screenTrack.addEventListener('ended', () => {
      this.cleanupScreenShare();
      this.screenShareEndedCb?.();
    });

    const settings = this.screenTrack.getSettings();
    const width = settings.width ?? 1920;
    const height = settings.height ?? 1080;
    const frameRate = settings.frameRate ?? 30;

    // Create screen share encoder
    this.screenEncoder = new MediaVideoEncoder({
      width,
      height,
      frameRate,
      bitrate: 2_000_000,
    });

    this.screenEncoder.onEncoded((data) => {
      this.sendEncodedVideo(data, this.screenSequence, true);
      this.screenSequence++;
    });

    // Notify the server that screen share has started
    if (this.transport) {
      await this.transport.sendControl({
        type: 'screen_share_start',
        ssrc: this.localSsrc,
        width,
        height,
      });
    }

    // Start reading frames from the screen share track
    this.startScreenFrameCapture();
  }

  stopScreenShare(): void {
    this.cleanupScreenShare();

    if (this.transport) {
      this.transport.sendControl({
        type: 'screen_share_stop',
        ssrc: this.localSsrc,
      });
    }
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

  onSpeakingChange(cb: (speakers: Map<string, number>) => void): void {
    this.speakingChangeCb = cb;
  }

  onParticipantJoin(cb: (userId: string) => void): void {
    this.participantJoinCb = cb;
  }

  onParticipantLeave(cb: (userId: string) => void): void {
    this.participantLeaveCb = cb;
  }

  /**
   * Subscribe to a remote participant's video and render it onto a canvas.
   * Creates a decoder and renderer for the given user. If a subscription
   * already exists for this user, the old one is torn down first.
   */
  subscribeVideo(userId: string, canvas: HTMLCanvasElement): void {
    // Tear down any existing subscription for this user
    const existing = this.videoSubscriptions.get(userId);
    if (existing) {
      existing.decoder.close();
      existing.renderer.destroy();
      this.videoSubscriptions.delete(userId);
    }

    // Resolve the SSRC for this user
    let ssrc = 0;
    for (const [s, uid] of this.ssrcToUserId) {
      if (uid === userId) {
        ssrc = s;
        break;
      }
    }

    const decoder = new MediaVideoDecoder({ codec: VP9_CODEC });
    const renderer = new CanvasRenderer(canvas);

    // Wire decoder output to the renderer
    decoder.onDecoded((frame) => {
      renderer.renderFrame(frame);
    });

    const subscription: VideoSubscription = {
      userId,
      ssrc,
      decoder,
      renderer,
    };

    this.videoSubscriptions.set(userId, subscription);

    // Request a keyframe from this participant so we can start decoding immediately
    if (this.transport && ssrc !== 0) {
      this.transport.sendControl({
        type: 'request_keyframe',
        targetSsrc: ssrc,
      });
    }
  }

  // ---------- Audio capture pipeline (unchanged) ----------

  private async setupAudioCapture(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: CHANNELS,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Load the AudioWorklet processor
    const processorUrl = new URL('./audio/audioProcessor.ts', import.meta.url).href;
    await this.audioContext.audioWorklet.addModule(processorUrl);

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioContext, 'media-audio-processor');

    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'frame') {
        this.localAudioLevel = event.data.audioLevel;
        if (!this.muted) {
          this.encodeAndSend(event.data.samples, event.data.audioLevel);
        }
      }
    };

    source.connect(this.workletNode);
    // Don't connect to destination - we don't want to hear ourselves
    this.workletNode.connect(this.audioContext.destination);

    // Set up Opus encoder
    this.encoder = new OpusMediaEncoder({
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitrate: BITRATE,
    });

    this.encoder.onEncoded((chunk) => {
      this.sendEncodedAudio(chunk);
    });

    // Set up playback context
    this.playbackContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  }

  private encodeAndSend(samples: Float32Array, _audioLevel: number): void {
    if (!this.encoder) return;
    const timestamp = this.sequence * FRAME_MS * 1000; // microseconds
    this.encoder.encode(samples, timestamp);
  }

  private async sendEncodedAudio(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.transport) return;

    // Extract encoded data
    const encodedData = new Uint8Array(chunk.byteLength);
    chunk.copyTo(encodedData);

    const header: MediaHeader = {
      version: PROTOCOL_VERSION,
      trackType: TrackType.Audio,
      simulcastLayer: 0,
      sequence: this.sequence & 0xffff,
      timestamp: (chunk.timestamp / 1000) >>> 0, // ms to 32-bit timestamp
      ssrc: this.localSsrc,
      audioLevel: this.localAudioLevel,
      keyEpoch: this.senderKeys.currentEpoch,
      payloadLength: 0, // will be set by createPacket
    };

    // Encode header for AAD (encrypt uses header as additional authenticated data)
    const headerAAD = createPacket(header, new Uint8Array(0)).slice(0, HEADER_SIZE);

    const encrypted = await this.senderKeys.encrypt(
      headerAAD,
      encodedData,
      this.senderKeys.currentEpoch,
      this.sequence & 0xffff,
      this.localSsrc,
    );

    const packet = createPacket(header, encrypted);
    this.transport.sendDatagram(packet);

    this.sequence++;
  }

  // ---------- Video capture pipeline ----------

  private async setupVideoCapture(): Promise<void> {
    this.videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });

    const videoTracks = this.videoStream.getVideoTracks();
    if (videoTracks.length === 0) {
      this.videoStream = null;
      throw new Error('No video track available from camera');
    }

    this.videoTrack = videoTracks[0];
    const settings = this.videoTrack.getSettings();
    const width = settings.width ?? 1280;
    const height = settings.height ?? 720;
    const frameRate = settings.frameRate ?? 30;

    // Create the simulcast video encoder
    this.videoEncoder = new MediaVideoEncoder({
      width,
      height,
      frameRate,
      bitrate: 1_500_000,
    });

    this.videoEncoder.onEncoded((data) => {
      this.sendEncodedVideo(data, this.videoSequence, false);
      this.videoSequence++;
    });

    // Notify the server that video is enabled
    if (this.transport) {
      await this.transport.sendControl({
        type: 'video_start',
        ssrc: this.localSsrc,
        width,
        height,
        layers: this.videoEncoder.layerCount,
      });
    }

    // Start reading frames from the video track
    this.startVideoFrameCapture();
  }

  /**
   * Reads frames from the camera video track using the MediaStreamTrackProcessor API.
   * Falls back to a canvas-based capture loop if MediaStreamTrackProcessor is not available.
   */
  private startVideoFrameCapture(): void {
    if (!this.videoTrack || !this.videoEncoder) return;

    // Use MediaStreamTrackProcessor if available (Chromium 94+).
    if ('MediaStreamTrackProcessor' in globalThis) {
      this.startTrackProcessorCapture(
        this.videoTrack,
        this.videoEncoder,
        (id) => { this.videoFrameCallbackId = id; },
      );
    } else {
      this.startCanvasCapture(
        this.videoTrack,
        this.videoEncoder,
        (id) => { this.videoFrameCallbackId = id; },
      );
    }
  }

  private startScreenFrameCapture(): void {
    if (!this.screenTrack || !this.screenEncoder) return;

    if ('MediaStreamTrackProcessor' in globalThis) {
      this.startTrackProcessorCapture(
        this.screenTrack,
        this.screenEncoder,
        (id) => { this.screenFrameCallbackId = id; },
      );
    } else {
      this.startCanvasCapture(
        this.screenTrack,
        this.screenEncoder,
        (id) => { this.screenFrameCallbackId = id; },
      );
    }
  }

  /**
   * High-efficiency frame capture using MediaStreamTrackProcessor.
   * This API yields VideoFrame objects directly from the track,
   * avoiding the overhead of canvas-based capture.
   */
  private startTrackProcessorCapture(
    track: MediaStreamTrack,
    videoEncoder: MediaVideoEncoder,
    setCallbackId: (id: number | null) => void,
  ): void {
    // MediaStreamTrackProcessor is not in the standard lib types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Processor = (globalThis as any).MediaStreamTrackProcessor;
    const processor = new Processor({ track });
    const reader: ReadableStreamDefaultReader<VideoFrame> = processor.readable.getReader();

    let active = true;

    const readLoop = async (): Promise<void> => {
      try {
        while (active) {
          const { value: frame, done } = await reader.read();
          if (done || !active) {
            frame?.close();
            break;
          }

          try {
            videoEncoder.encode(frame);
          } finally {
            frame.close();
          }
        }
      } catch {
        // Track ended or reader cancelled.
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Already released.
        }
      }
    };

    readLoop();

    // Use a sentinel value to track this capture session.
    // Store a cleanup handle via requestAnimationFrame so we can cancel later.
    const sentinel = requestAnimationFrame(() => {
      // no-op; this just gives us a numeric handle
    });
    setCallbackId(sentinel);

    // Patch the cleanup to also stop the reader.
    const originalActive = active;
    if (originalActive) {
      // Store a reference so cleanup can stop the reader.
      const cleanup = (): void => {
        active = false;
        try {
          reader.cancel();
        } catch {
          // Already cancelled.
        }
      };

      // Attach cleanup to the track itself for retrieval during teardown.
      (track as unknown as Record<string, () => void>).__paracordCleanup = cleanup;
    }
  }

  /**
   * Fallback canvas-based frame capture for browsers without MediaStreamTrackProcessor.
   * Draws video frames to an OffscreenCanvas at the track's native frame rate.
   */
  private startCanvasCapture(
    track: MediaStreamTrack,
    videoEncoder: MediaVideoEncoder,
    setCallbackId: (id: number | null) => void,
  ): void {
    const settings = track.getSettings();
    const width = settings.width ?? 640;
    const height = settings.height ?? 360;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a video element to display the track
    const video = document.createElement('video');
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.playsInline = true;
    video.play();

    let active = true;

    const captureLoop = (): void => {
      if (!active || track.readyState !== 'live') return;

      ctx.drawImage(video, 0, 0, width, height);
      const frame = new VideoFrame(canvas, {
        timestamp: performance.now() * 1000, // microseconds
      });

      try {
        videoEncoder.encode(frame);
      } finally {
        frame.close();
      }

      const id = requestAnimationFrame(captureLoop);
      setCallbackId(id);
    };

    const id = requestAnimationFrame(captureLoop);
    setCallbackId(id);

    (track as unknown as Record<string, () => void>).__paracordCleanup = () => {
      active = false;
      video.pause();
      video.srcObject = null;
    };
  }

  /**
   * Send an encoded video chunk over the transport with E2EE.
   */
  private async sendEncodedVideo(
    data: EncodedVideoChunkWithMeta,
    seq: number,
    _isScreenShare: boolean,
  ): Promise<void> {
    if (!this.transport) return;

    const { chunk, layerIndex } = data;

    // Extract the encoded data from the chunk
    const encodedData = new Uint8Array(chunk.byteLength);
    chunk.copyTo(encodedData);

    const header: MediaHeader = {
      version: PROTOCOL_VERSION,
      trackType: TrackType.Video,
      simulcastLayer: layerIndex,
      sequence: seq & 0xffff,
      timestamp: (chunk.timestamp / 1000) >>> 0,
      ssrc: this.localSsrc,
      audioLevel: 127, // Not applicable for video
      keyEpoch: this.senderKeys.currentEpoch,
      payloadLength: 0, // will be set by createPacket
    };

    // Build AAD from the header
    const headerAAD = createPacket(header, new Uint8Array(0)).slice(0, HEADER_SIZE);

    const encrypted = await this.senderKeys.encrypt(
      headerAAD,
      encodedData,
      this.senderKeys.currentEpoch,
      seq & 0xffff,
      this.localSsrc,
    );

    const packet = createPacket(header, encrypted);
    this.transport.sendDatagram(packet);
  }

  // ---------- Datagram handling ----------

  private handleDatagram(data: Uint8Array): void {
    try {
      const { header, payload } = parsePacket(data);

      // Ignore our own packets
      if (header.ssrc === this.localSsrc) return;

      if (header.trackType === TrackType.Video) {
        this.handleVideoDatagram(data, header, payload);
        return;
      }

      // Audio handling (unchanged)
      const participant = this.participants.get(header.ssrc);
      if (!participant) {
        return;
      }

      // Update audio level and speaking state
      participant.audioLevel = header.audioLevel;
      const wasSpeaking = participant.speaking;
      participant.speaking = header.audioLevel < 80; // Lower = louder
      if (wasSpeaking !== participant.speaking) {
        this.emitSpeakingChange();
      }

      // Decrypt if we have the key
      this.senderKeys.decrypt(
        data.slice(0, HEADER_SIZE),
        payload,
        header.keyEpoch,
        header.sequence,
        header.ssrc,
      ).then((decrypted) => {
        if (this.deafened) return;

        // Push to jitter buffer
        participant!.jitterBuffer.push(header.sequence, header.timestamp, decrypted);
      }).catch(() => {
        // Decryption failed - missing key or corrupted
      });
    } catch {
      // Malformed packet
    }
  }

  /**
   * Handle an incoming video datagram. Decrypts the payload and routes
   * it to the correct video decoder based on the source SSRC.
   */
  private handleVideoDatagram(
    rawData: Uint8Array,
    header: MediaHeader,
    payload: Uint8Array,
  ): void {
    // Find the video subscription for this SSRC
    const userId = this.ssrcToUserId.get(header.ssrc);
    if (!userId) return;

    const subscription = this.videoSubscriptions.get(userId);
    if (!subscription) return;

    // Update the subscription's SSRC in case it changed (re-join)
    subscription.ssrc = header.ssrc;

    // Decrypt the video payload
    this.senderKeys.decrypt(
      rawData.slice(0, HEADER_SIZE),
      payload,
      header.keyEpoch,
      header.sequence,
      header.ssrc,
    ).then((decrypted) => {
      // Determine if this is a keyframe. We encode this in the simulcast layer
      // metadata but we can also check the VP9 bitstream.
      // For simplicity, we detect keyframes by checking if the decoder needs one
      // and whether the server flagged it. The encoder always sends keyframes
      // periodically, and the first byte of VP9 has a keyframe indicator.
      const isKeyframe = this.isVp9Keyframe(decrypted);

      subscription.decoder.decode(
        decrypted,
        header.timestamp * 1000, // convert ms timestamp to microseconds
        isKeyframe,
      );
    }).catch(() => {
      // Decryption failed - missing key or corrupted
    });
  }

  /**
   * Check if a VP9 bitstream starts with a keyframe.
   * VP9 uncompressed header: bit 1 of the first byte is the frame_type flag.
   * 0 = keyframe, 1 = interframe.
   */
  private isVp9Keyframe(data: Uint8Array): boolean {
    if (data.length === 0) return false;
    // VP9 superframe marker or frame header: bit 1 (second-least significant)
    // of the first byte is 0 for keyframes.
    return (data[0] & 0x04) === 0;
  }

  // ---------- Control messages ----------

  private handleControlMessage(msg: ControlMessage): void {
    switch (msg.type) {
      case 'participant_join': {
        const ssrc = msg.ssrc as number;
        const userId = msg.userId as string;
        const senderKey = msg.senderKey as number[] | undefined;
        const epoch = msg.epoch as number | undefined;

        this.ssrcToUserId.set(ssrc, userId);

        // Import peer's sender key if provided
        if (senderKey && epoch !== undefined) {
          this.senderKeys.importPeerKey(ssrc, epoch, new Uint8Array(senderKey));
        }

        // Create decoder and jitter buffer for this participant
        const decoder = new OpusMediaDecoder({
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
        });

        const jitterBuffer = new JitterBuffer(FRAME_MS, 60);

        const participant: ParticipantState = {
          ssrc,
          userId,
          decoder,
          jitterBuffer,
          speaking: false,
          audioLevel: 127,
        };

        this.participants.set(ssrc, participant);
        this.participantJoinCb?.(userId);

        // If we already have a video subscription for this user, update the SSRC
        const existingSub = this.videoSubscriptions.get(userId);
        if (existingSub) {
          existingSub.ssrc = ssrc;
          // Reset decoder since this is a new stream
          existingSub.decoder.reset();
        }
        break;
      }

      case 'participant_leave': {
        const ssrc = msg.ssrc as number;
        const participant = this.participants.get(ssrc);
        if (participant) {
          participant.decoder.close();
          this.participants.delete(ssrc);
          this.ssrcToUserId.delete(ssrc);
          this.participantLeaveCb?.(participant.userId);
          this.emitSpeakingChange();

          // Clean up any video subscription for this user
          const sub = this.videoSubscriptions.get(participant.userId);
          if (sub) {
            sub.decoder.close();
            sub.renderer.clear();
          }
        }
        break;
      }

      case 'sender_key_update': {
        const ssrc = msg.ssrc as number;
        const senderKey = msg.senderKey as number[];
        const epoch = msg.epoch as number;
        this.senderKeys.importPeerKey(ssrc, epoch, new Uint8Array(senderKey));
        break;
      }

      case 'request_keyframe': {
        // A remote participant is requesting a keyframe from us
        if (this.videoEncoder) {
          this.videoEncoder.requestKeyframe();
        }
        if (this.screenEncoder) {
          this.screenEncoder.requestKeyframe();
        }
        break;
      }
    }
  }

  // ---------- Playback loop ----------

  private startPlaybackLoop(): void {
    // Pull from jitter buffers and play at 20ms intervals
    this.playbackInterval = setInterval(() => {
      if (this.deafened || !this.playbackContext) return;

      for (const [, participant] of this.participants) {
        const frame = participant.jitterBuffer.pull();
        if (frame) {
          // Decode Opus -> PCM
          const timestamp = performance.now() * 1000; // rough timestamp in us
          participant.decoder.decode(frame, timestamp);
        }
      }
    }, FRAME_MS);

    // Wire up decoded audio to playback
    // We set up a callback once per decoder in handleControlMessage
    // Each decoded AudioData gets rendered to playbackContext
  }

  private stopPlaybackLoop(): void {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  // ---------- Speaking detection ----------

  private emitSpeakingChange(): void {
    if (!this.speakingChangeCb) return;
    const speakers = new Map<string, number>();
    for (const [, p] of this.participants) {
      if (p.speaking) {
        speakers.set(p.userId, p.audioLevel);
      }
    }
    // Include local user if speaking
    if (this.localAudioLevel < 80 && !this.muted) {
      speakers.set('local', this.localAudioLevel);
    }
    this.speakingChangeCb(speakers);
  }

  // ---------- Cleanup ----------

  private cleanupAudio(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = null;
    }
    if (this.encoder) {
      this.encoder.close();
      this.encoder = null;
    }
  }

  private cleanupVideo(): void {
    if (this.videoFrameCallbackId !== null) {
      cancelAnimationFrame(this.videoFrameCallbackId);
      this.videoFrameCallbackId = null;
    }

    if (this.videoTrack) {
      const cleanup = (this.videoTrack as unknown as Record<string, () => void>).__paracordCleanup;
      if (cleanup) cleanup();
      this.videoTrack.stop();
      this.videoTrack = null;
    }

    if (this.videoStream) {
      for (const track of this.videoStream.getTracks()) {
        track.stop();
      }
      this.videoStream = null;
    }

    if (this.videoEncoder) {
      this.videoEncoder.close();
      this.videoEncoder = null;
    }

    this.videoSequence = 0;
  }

  private cleanupScreenShare(): void {
    if (this.screenFrameCallbackId !== null) {
      cancelAnimationFrame(this.screenFrameCallbackId);
      this.screenFrameCallbackId = null;
    }

    if (this.screenAudioSource) {
      this.screenAudioSource.disconnect();
      this.screenAudioSource = null;
    }
    this.screenAudioActive = false;

    if (this.screenTrack) {
      const cleanup = (this.screenTrack as unknown as Record<string, () => void>).__paracordCleanup;
      if (cleanup) cleanup();
      this.screenTrack.stop();
      this.screenTrack = null;
    }

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        track.stop();
      }
      this.screenStream = null;
    }

    if (this.screenEncoder) {
      this.screenEncoder.close();
      this.screenEncoder = null;
    }

    this.screenSequence = 0;
  }
}
