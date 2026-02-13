import { useEffect, useRef, useState } from 'react';
import { Track, RoomEvent, type RemoteTrackPublication } from 'livekit-client';
import { useVoiceStore } from '../../stores/voiceStore';
import { useAuthStore } from '../../stores/authStore';
import { VideoOff } from 'lucide-react';

interface VideoTile {
  participantId: string;
  username: string;
  isLocal: boolean;
}

export type VideoGridLayout = 'grid' | 'compact' | 'sidebar' | 'pip';

export function VideoGrid({ layout = 'grid' }: { layout?: VideoGridLayout }) {
  const room = useVoiceStore((s) => s.room);
  const connected = useVoiceStore((s) => s.connected);
  const speakingUsers = useVoiceStore((s) => s.speakingUsers);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const [tiles, setTiles] = useState<VideoTile[]>([]);
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 640px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const updateIsNarrow = () => setIsNarrow(mediaQuery.matches);
    updateIsNarrow();
    mediaQuery.addEventListener('change', updateIsNarrow);
    return () => mediaQuery.removeEventListener('change', updateIsNarrow);
  }, []);

  useEffect(() => {
    if (!room || !connected) {
      setTiles([]);
      return;
    }

    const recompute = () => {
      const next: VideoTile[] = [];

      // Check local participant
      for (const pub of room.localParticipant.videoTrackPublications.values()) {
        if (
          pub.source === Track.Source.Camera &&
          !pub.isMuted &&
          pub.track &&
          pub.track.mediaStreamTrack?.readyState !== 'ended'
        ) {
          next.push({
            participantId: room.localParticipant.identity,
            username: room.localParticipant.name || 'You',
            isLocal: true,
          });
          break;
        }
      }

      // Check remote participants
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.videoTrackPublications.values()) {
          if (pub.source === Track.Source.Camera) {
            // Subscribe to camera tracks
            if (!pub.isSubscribed) {
              pub.setSubscribed(true);
            }
            if (!pub.isMuted && pub.track && pub.track.mediaStreamTrack?.readyState !== 'ended') {
              next.push({
                participantId: participant.identity,
                username: participant.name || `User ${participant.identity.slice(0, 6)}`,
                isLocal: false,
              });
              break;
            }
          }
        }
      }

      setTiles(next);
    };

    recompute();

    room.on(RoomEvent.TrackSubscribed, recompute);
    room.on(RoomEvent.TrackUnsubscribed, recompute);
    room.on(RoomEvent.TrackPublished, recompute);
    room.on(RoomEvent.TrackUnpublished, recompute);
    room.on(RoomEvent.TrackMuted, recompute);
    room.on(RoomEvent.TrackUnmuted, recompute);
    room.on(RoomEvent.ParticipantConnected, recompute);
    room.on(RoomEvent.ParticipantDisconnected, recompute);
    room.on(RoomEvent.LocalTrackPublished, recompute);
    room.on(RoomEvent.LocalTrackUnpublished, recompute);

    const pollInterval = setInterval(recompute, 2000);

    return () => {
      clearInterval(pollInterval);
      room.off(RoomEvent.TrackSubscribed, recompute);
      room.off(RoomEvent.TrackUnsubscribed, recompute);
      room.off(RoomEvent.TrackPublished, recompute);
      room.off(RoomEvent.TrackUnpublished, recompute);
      room.off(RoomEvent.TrackMuted, recompute);
      room.off(RoomEvent.TrackUnmuted, recompute);
      room.off(RoomEvent.ParticipantConnected, recompute);
      room.off(RoomEvent.ParticipantDisconnected, recompute);
      room.off(RoomEvent.LocalTrackPublished, recompute);
      room.off(RoomEvent.LocalTrackUnpublished, recompute);
    };
  }, [room, connected]);

  if (tiles.length === 0) return null;

  if (layout === 'compact') {
    return (
      <div className="flex shrink-0 gap-2 overflow-x-auto px-1" style={{ maxHeight: isNarrow ? '96px' : '120px' }}>
        {tiles.map((tile) => (
          <VideoTileView
            key={tile.participantId}
            tile={tile}
            isSpeaking={speakingUsers.has(tile.participantId)}
            currentUserId={currentUserId}
            compact
            compactSize={isNarrow ? 'small' : 'default'}
          />
        ))}
      </div>
    );
  }

  if (layout === 'sidebar') {
    return (
      <div className="flex h-full flex-col gap-2 p-1">
        {tiles.map((tile) => (
          <div key={tile.participantId} className="min-h-0 flex-1">
            <VideoTileView
              tile={tile}
              isSpeaking={speakingUsers.has(tile.participantId)}
              currentUserId={currentUserId}
              fill
            />
          </div>
        ))}
      </div>
    );
  }

  if (layout === 'pip') {
    return (
      <div className="flex gap-1.5 rounded-xl bg-black/40 p-1.5 backdrop-blur-sm">
        {tiles.map((tile) => (
          <VideoTileView
            key={tile.participantId}
            tile={tile}
            isSpeaking={speakingUsers.has(tile.participantId)}
            currentUserId={currentUserId}
            compact
            compactSize={isNarrow ? 'small' : 'default'}
          />
        ))}
      </div>
    );
  }

  // Grid layout: 1 tile = full, 2 = side by side, 3-4 = 2x2, etc.
  const cols = isNarrow ? 1 : (tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3);

  return (
    <div
      className="grid gap-2 p-2"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        maxHeight: tiles.length <= 2 ? (isNarrow ? '220px' : '280px') : (isNarrow ? '320px' : '400px'),
      }}
    >
      {tiles.map((tile) => (
        <VideoTileView
          key={tile.participantId}
          tile={tile}
          isSpeaking={speakingUsers.has(tile.participantId)}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}

function VideoTileView({
  tile,
  isSpeaking,
  currentUserId,
  compact = false,
  fill = false,
  compactSize = 'default',
}: {
  tile: VideoTile;
  isSpeaking: boolean;
  currentUserId: string | null;
  compact?: boolean;
  fill?: boolean;
  compactSize?: 'default' | 'small';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const room = useVoiceStore((s) => s.room);
  const [hasTrack, setHasTrack] = useState(false);

  useEffect(() => {
    if (!room || !videoRef.current) return;

    let trackEndedCleanup: (() => void) | null = null;

    const attachTrack = () => {
      const el = videoRef.current;
      if (!el) return;

      // Clean up previous track ended listener
      if (trackEndedCleanup) {
        trackEndedCleanup();
        trackEndedCleanup = null;
      }

      let mediaTrack: MediaStreamTrack | null = null;

      if (tile.isLocal) {
        // Local camera track
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        const track = pub?.track;
        if (track && track.mediaStreamTrack && !pub?.isMuted) {
          mediaTrack = track.mediaStreamTrack;
          const stream = new MediaStream([track.mediaStreamTrack]);
          el.srcObject = stream;
          el.muted = true; // Local preview should be muted
          void el.play().catch(() => {});
          setHasTrack(true);
        } else {
          setHasTrack(false);
        }
      } else {
        // Remote camera track
        const participant = room.remoteParticipants.get(tile.participantId);
        if (!participant) {
          setHasTrack(false);
          return;
        }
        let cameraTrack: RemoteTrackPublication | null = null;
        for (const pub of participant.videoTrackPublications.values()) {
          if (pub.source === Track.Source.Camera && !pub.isMuted && pub.track) {
            cameraTrack = pub;
            break;
          }
        }
        if (cameraTrack?.track) {
          mediaTrack = cameraTrack.track.mediaStreamTrack ?? null;
          cameraTrack.track.attach(el);
          setHasTrack(true);
        } else {
          setHasTrack(false);
        }
      }

      // Listen for track ended to clear stale tiles immediately
      if (mediaTrack) {
        const onEnded = () => {
          setHasTrack(false);
          if (videoRef.current) {
            videoRef.current.srcObject = null;
          }
        };
        mediaTrack.addEventListener('ended', onEnded);
        trackEndedCleanup = () => {
          mediaTrack!.removeEventListener('ended', onEnded);
        };
      }
    };

    attachTrack();

    // Re-attach on any track events — the function is cheap and self-filtering
    room.on(RoomEvent.TrackSubscribed, attachTrack);
    room.on(RoomEvent.TrackUnsubscribed, attachTrack);
    room.on(RoomEvent.LocalTrackPublished, attachTrack);
    room.on(RoomEvent.LocalTrackUnpublished, attachTrack);

    return () => {
      room.off(RoomEvent.TrackSubscribed, attachTrack);
      room.off(RoomEvent.TrackUnsubscribed, attachTrack);
      room.off(RoomEvent.LocalTrackPublished, attachTrack);
      room.off(RoomEvent.LocalTrackUnpublished, attachTrack);
      if (trackEndedCleanup) {
        trackEndedCleanup();
        trackEndedCleanup = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [room, tile.participantId, tile.isLocal]);

  const isMe = currentUserId != null && tile.participantId === currentUserId;
  const displayName = isMe ? 'You' : tile.username;

  return (
    <div
      className="relative overflow-hidden rounded-xl border bg-bg-mod-subtle transition-shadow duration-200"
      style={{
        borderColor: isSpeaking ? 'var(--accent-success)' : 'var(--border-subtle)',
        boxShadow: isSpeaking ? '0 0 12px rgba(34, 197, 94, 0.3)' : 'none',
        ...(fill
          ? { height: '100%', width: '100%' }
          : {
              aspectRatio: '16 / 9',
              ...(compact
                ? compactSize === 'small'
                  ? { height: '82px', width: '132px', flexShrink: 0 }
                  : { height: '100px', width: '178px', flexShrink: 0 }
                : {}),
            }),
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className="h-full w-full object-cover"
        style={{
          transform: tile.isLocal ? 'scaleX(-1)' : undefined,
          display: hasTrack ? 'block' : 'none',
        }}
      />
      {!hasTrack && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <VideoOff size={compact ? 16 : 24} className="text-text-muted" />
            {!compact && <span className="text-xs text-text-muted">No video</span>}
          </div>
        </div>
      )}
      {/* Name badge */}
      <div className={`absolute bottom-1 left-1 flex items-center gap-1 rounded-lg bg-black/60 backdrop-blur-sm ${compact ? 'px-1.5 py-0.5' : 'bottom-2 left-2 gap-1.5 px-2.5 py-1'}`}>
        <span className={`font-medium text-white ${compact ? 'text-[10px]' : 'text-xs'}`}>{displayName}</span>
      </div>
    </div>
  );
}
