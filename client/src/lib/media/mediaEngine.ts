export interface ScreenShareConfig {
  audio: boolean;
  maxFrameRate?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface MediaEngine {
  connect(endpoint: string, token: string, certHash?: string): Promise<void>;
  disconnect(): Promise<void>;
  setMute(muted: boolean): void;
  setDeaf(deafened: boolean): void;
  enableVideo(enabled: boolean): void;
  startScreenShare(config: ScreenShareConfig): Promise<void>;
  stopScreenShare(): void;
  /** Whether stream-audio capture is currently active for screen sharing. */
  isScreenShareAudioActive(): boolean;
  /** Return the local screen share video track (if actively sharing). */
  getLocalScreenShareTrack(): MediaStreamTrack | null;
  /** Register a callback fired when the user stops screen sharing via the
   *  browser's native "Stop sharing" UI (track ended externally). */
  onScreenShareEnded(cb: () => void): void;
  onSpeakingChange(cb: (speakers: Map<string, number>) => void): void;
  onParticipantJoin(cb: (userId: string) => void): void;
  onParticipantLeave(cb: (userId: string) => void): void;
  subscribeVideo(userId: string, canvas: HTMLCanvasElement): void;
}

export async function createMediaEngine(): Promise<MediaEngine> {
  // Platform detection: Tauri desktop vs browser
  // Tauri v2 exposes __TAURI_INTERNALS__, v1 used __TAURI__.
  if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
    const { TauriMediaEngine } = await import('./tauriMediaEngine');
    return new TauriMediaEngine();
  }
  const { BrowserMediaEngine } = await import('./browserMediaEngine');
  return new BrowserMediaEngine();
}
