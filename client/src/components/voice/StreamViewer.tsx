import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  Monitor,
  MonitorOff,
  Eye,
  EyeOff,
  Signal,
} from 'lucide-react';
import { RoomEvent, Track, VideoQuality } from 'livekit-client';
import { useVoiceStore } from '../../stores/voiceStore';

interface StreamViewerProps {
  streamerName?: string;
  expectingStream?: boolean;
  onStopStream?: () => void;
}

export function StreamViewer({
  streamerName,
  expectingStream = false,
  onStopStream,
}: StreamViewerProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [activeStreamer, setActiveStreamer] = useState<string | null>(null);
  const [hasActiveTrack, setHasActiveTrack] = useState(false);
  const [isOwnStream, setIsOwnStream] = useState(false);
  const [hideSelfPreview, setHideSelfPreview] = useState(false);
  const [quality, setQuality] = useState<
    'auto' | 'low' | 'medium' | 'high' | 'source'
  >('auto');
  const [isMaximized, setIsMaximized] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const room = useVoiceStore((s) => s.room);
  const selfStream = useVoiceStore((s) => s.selfStream);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamStartTime = useRef<number>(Date.now());

  const displayName = streamerName ?? activeStreamer ?? 'Someone';

  // Elapsed time counter
  useEffect(() => {
    if (!hasActiveTrack && !expectingStream) return;
    streamStartTime.current = Date.now();
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - streamStartTime.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [hasActiveTrack, expectingStream]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Escape key exits maximized mode
  useEffect(() => {
    if (!isMaximized) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMaximized(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMaximized]);

  // Attach video track
  const attachTrack = useCallback(() => {
    const videoEl = videoRef.current;
    if (!room || !videoEl) return;

    let foundTrack: MediaStreamTrack | null = null;
    let foundStreamer: string | null = null;
    let isSelf = false;

    // Prefer remote screen shares
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.videoTrackPublications.values()) {
        if (
          publication.source === Track.Source.ScreenShare &&
          publication.track
        ) {
          if (quality !== 'auto') {
            if (quality === 'low') publication.setVideoQuality(VideoQuality.LOW);
            if (quality === 'medium') publication.setVideoQuality(VideoQuality.MEDIUM);
            if (quality === 'high' || quality === 'source')
              publication.setVideoQuality(VideoQuality.HIGH);
          }
          foundTrack = publication.track.mediaStreamTrack;
          foundStreamer = participant.name || participant.identity;
          break;
        }
      }
      if (foundTrack) break;
    }

    // Fall back to local screen share
    if (!foundTrack) {
      for (const publication of room.localParticipant.videoTrackPublications.values()) {
        if (
          publication.source === Track.Source.ScreenShare &&
          publication.track
        ) {
          foundTrack = publication.track.mediaStreamTrack;
          foundStreamer = 'You';
          isSelf = true;
          break;
        }
      }
    }

    if (foundTrack && !(isSelf && hideSelfPreview)) {
      const stream = new MediaStream([foundTrack]);
      videoEl.srcObject = stream;
      videoEl.play().catch(() => { });
    } else {
      videoEl.srcObject = null;
    }

    setHasActiveTrack(Boolean(foundTrack));
    setActiveStreamer(foundStreamer);
    setIsOwnStream(isSelf);
  }, [room, quality, hideSelfPreview]);

  useEffect(() => {
    if (!room) return;

    attachTrack();
    room.on(RoomEvent.TrackSubscribed, attachTrack);
    room.on(RoomEvent.TrackUnsubscribed, attachTrack);
    room.on(RoomEvent.ParticipantConnected, attachTrack);
    room.on(RoomEvent.ParticipantDisconnected, attachTrack);
    room.on(RoomEvent.LocalTrackPublished, attachTrack);
    room.on(RoomEvent.LocalTrackUnpublished, attachTrack);

    return () => {
      room.off(RoomEvent.TrackSubscribed, attachTrack);
      room.off(RoomEvent.TrackUnsubscribed, attachTrack);
      room.off(RoomEvent.ParticipantConnected, attachTrack);
      room.off(RoomEvent.ParticipantDisconnected, attachTrack);
      room.off(RoomEvent.LocalTrackPublished, attachTrack);
      room.off(RoomEvent.LocalTrackUnpublished, attachTrack);
      setHasActiveTrack(false);
      const videoEl = videoRef.current;
      if (videoEl) videoEl.srcObject = null;
    };
  }, [room, attachTrack]);

  const toggleMaximized = () => setIsMaximized((prev) => !prev);

  const showVideo = hasActiveTrack && !(isOwnStream && hideSelfPreview);

  return (
    <div
      ref={containerRef}
      className={
        isMaximized
          ? 'fixed inset-0 z-50 flex flex-col overflow-hidden'
          : 'relative flex h-full w-full flex-col overflow-hidden'
      }
      style={{ backgroundColor: 'var(--bg-tertiary)' }}
    >
      {/* ── Top bar ── */}
      <div
        className="relative z-10 flex items-center justify-between gap-3 px-5 py-3"
        style={{
          backgroundColor: 'var(--bg-floating)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {/* Left: streamer info + live badge */}
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--accent-danger) 24%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-danger) 45%, transparent)',
            }}>
            <Signal size={12} style={{ color: 'var(--accent-danger)' }} className="animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-danger)' }}>
              Live
            </span>
          </div>
          <span className="truncate text-[15px] font-semibold text-text-primary">
            {displayName}
            {displayName !== 'You' && "'s stream"}
          </span>
          <span className="text-sm font-mono text-text-muted">
            {formatTime(elapsedSeconds)}
          </span>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2">
          {/* Viewer quality selector — only useful for remote streams */}
          {!isOwnStream && (
            <select
              value={quality}
              onChange={(e) =>
                setQuality(
                  e.target.value as 'auto' | 'low' | 'medium' | 'high' | 'source'
                )
              }
              className="h-9 rounded-lg border border-border-subtle bg-bg-mod-subtle px-3 text-sm font-medium text-text-secondary outline-none transition-colors hover:bg-bg-mod-strong hover:text-text-primary"
              title="Viewing quality"
            >
              <option value="auto">Auto</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="source">Source</option>
            </select>
          )}

          {/* Volume toggle */}
          <button
            onClick={() => setIsMuted((prev) => !prev)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-bg-mod-subtle text-text-secondary transition-colors hover:bg-bg-mod-strong hover:text-text-primary"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          {/* Hide own preview (only when streaming) */}
          {isOwnStream && (
            <button
              onClick={() => setHideSelfPreview((prev) => !prev)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-bg-mod-subtle text-text-secondary transition-colors hover:bg-bg-mod-strong hover:text-text-primary"
              title={hideSelfPreview ? 'Show your stream preview' : 'Hide your stream preview (saves resources)'}
            >
              {hideSelfPreview ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}

          {/* Maximize within app */}
          <button
            onClick={toggleMaximized}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-bg-mod-subtle text-text-secondary transition-colors hover:bg-bg-mod-strong hover:text-text-primary"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>

          {/* Stop stream (only streamer) */}
          {(selfStream || isOwnStream) && onStopStream && (
            <button
              onClick={onStopStream}
              className="ml-1 flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold text-accent-danger transition-colors hover:bg-accent-danger/18"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-danger) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-danger) 38%, transparent)',
              }}
              title="Stop streaming"
            >
              <MonitorOff size={15} />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* ── Video area ── */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {/* Single video element always in the DOM so ref is stable */}
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          autoPlay
          playsInline
          muted={isMuted}
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            // Hide visually when we don't want to show the video
            opacity: showVideo ? 1 : 0,
            position: showVideo ? 'relative' : 'absolute',
          }}
        />

        {/* Overlay placeholder states on top of the video */}
        {!showVideo && (
          <div className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <div className="flex flex-col items-center gap-4">
              {isOwnStream && hideSelfPreview ? (
                /* Hidden own preview state */
                <>
                  <div
                    className="flex h-20 w-20 items-center justify-center rounded-2xl"
                    style={{
                      background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-primary-hover))',
                      boxShadow: '0 12px 40px color-mix(in srgb, var(--accent-primary) 35%, transparent)',
                    }}
                  >
                    <Monitor size={32} className="text-white" />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-semibold text-text-primary">
                      Stream preview hidden
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Your stream is still live. Others can see it.
                    </div>
                  </div>
                </>
              ) : expectingStream ? (
                /* Waiting for track to publish */
                <>
                  <div className="relative flex h-20 w-20 items-center justify-center">
                    <div
                      className="absolute inset-0 animate-spin rounded-full"
                      style={{
                        border: '2px solid transparent',
                        borderTopColor: 'var(--accent-primary)',
                        borderRightColor: 'var(--accent-primary)',
                      }}
                    />
                    <div
                      className="flex h-16 w-16 items-center justify-center rounded-full"
                      style={{
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-primary-hover))',
                      }}
                    >
                      <Monitor size={26} className="text-white" />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-semibold text-text-primary">
                      Starting stream...
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Connecting to the media server
                    </div>
                  </div>
                </>
              ) : (
                /* No stream available */
                <>
                  <div
                    className="flex h-20 w-20 items-center justify-center rounded-2xl"
                    style={{
                      backgroundColor: 'var(--bg-mod-subtle)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <Monitor size={28} className="text-text-muted" />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-semibold text-text-secondary">
                      No active stream
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Waiting for someone to share their screen
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
