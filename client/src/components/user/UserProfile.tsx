import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, UserPlus, Ban, Users, CalendarDays } from 'lucide-react';
import type { User } from '../../types/index';
import { apiClient } from '../../api/client';
import { dmApi } from '../../api/dms';
import { relationshipApi } from '../../api/relationships';
import { useChannelStore } from '../../stores/channelStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useServerListStore } from '../../stores/serverListStore';
import {
  formatActivityElapsed,
  formatActivityLabel,
  getPrimaryActivity,
} from '../../lib/activityPresence';

interface MutualGuild {
  id: string;
  name: string;
  icon_url?: string | null;
}

interface MutualFriend {
  id: string;
  username: string;
  discriminator: number | string;
  avatar_hash?: string | null;
}

interface ProfileData {
  user: {
    id: string;
    username: string;
    discriminator: number | string;
    display_name?: string | null;
    avatar_hash?: string | null;
    banner_hash?: string | null;
    bio?: string | null;
    flags: number;
    created_at: string;
  };
  roles: Array<{ id: string; name: string; color: number }>;
  mutual_guilds: MutualGuild[];
  mutual_friends: MutualFriend[];
  created_at: string;
}

interface UserProfilePopupProps {
  user: User;
  position: { x: number; y: number };
  onClose: () => void;
  roles?: Array<{ id: string; name: string; color: number }>;
}

function intToHex(color: number): string {
  if (color === 0) return 'var(--text-secondary)';
  return '#' + color.toString(16).padStart(6, '0');
}

const STATUS_COLORS: Record<'online' | 'idle' | 'dnd' | 'offline', string> = {
  online: 'var(--status-online)',
  idle: 'var(--status-idle)',
  dnd: 'var(--status-dnd)',
  offline: 'var(--status-offline)',
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function UserProfilePopup({ user, position, onClose, roles = [] }: UserProfilePopupProps) {
  const navigate = useNavigate();
  const popupWidth = 344;
  const estimatedHeight = 520;
  const fitsLeft = position.x - popupWidth - 16 > 0;
  const left = fitsLeft
    ? Math.max(8, position.x - popupWidth - 12)
    : Math.min(position.x + 12, window.innerWidth - popupWidth - 8);
  const top = Math.max(8, Math.min(position.y, window.innerHeight - estimatedHeight - 8));
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const activeServerId = useServerListStore((state) => state.activeServerId);
  const presence = usePresenceStore((state) =>
    state.getPresence(user.id, activeServerId ?? undefined)
  );
  const status = (presence?.status as 'online' | 'idle' | 'dnd' | 'offline') || 'offline';
  const activity = useMemo(() => getPrimaryActivity(presence), [presence]);
  const activityLabel = useMemo(() => formatActivityLabel(activity), [activity]);
  const activityElapsed = useMemo(
    () => formatActivityElapsed(activity?.started_at, now),
    [activity?.started_at, now]
  );

  // Fetch profile data from API
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<ProfileData>(`/users/${user.id}/profile`)
      .then(({ data }) => {
        if (!cancelled) setProfileData(data);
      })
      .catch(() => {
        // Profile fetch is optional; popup still works without it
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // Merge roles: prefer API profile roles over passed-in roles
  const displayRoles = profileData?.roles && profileData.roles.length > 0
    ? profileData.roles
    : roles;

  const mutualGuilds = profileData?.mutual_guilds ?? [];
  const mutualFriends = profileData?.mutual_friends ?? [];
  const bannerHash = profileData?.user?.banner_hash ?? user.banner;
  const bio = profileData?.user?.bio ?? user.bio;
  const createdAt = profileData?.created_at ?? profileData?.user?.created_at ?? user.created_at;
  const isBotUser = user.bot;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`paracord:note:${user.id}`);
      if (saved) setNote(saved);
    } catch {
      /* ignore */
    }
  }, [user.id]);

  useEffect(() => {
    try {
      localStorage.setItem(`paracord:note:${user.id}`, note);
    } catch {
      /* ignore */
    }
  }, [user.id, note]);

  useEffect(() => {
    if (!activity?.started_at) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activity?.started_at]);

  const handleMessage = async () => {
    try {
      setActionError(null);
      const { data } = await dmApi.create(user.id);
      const dmChannels = useChannelStore.getState().channelsByGuild[''] || [];
      if (!dmChannels.some((c) => c.id === data.id)) {
        useChannelStore.getState().setDmChannels([...dmChannels, data]);
      }
      useChannelStore.getState().selectChannel(data.id);
      onClose();
      navigate(`/app/dms/${data.id}`);
    } catch {
      setActionError('Could not start a DM right now.');
    }
  };

  const handleAddFriend = async () => {
    try {
      setActionError(null);
      await relationshipApi.addFriend(user.username);
      onClose();
    } catch {
      setActionError('Could not send a friend request.');
    }
  };

  const handleBlock = async () => {
    try {
      setActionError(null);
      await relationshipApi.block(user.id);
      onClose();
    } catch {
      setActionError('Could not block this user.');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="glass-modal fixed z-50 overflow-hidden rounded-2xl border popup-enter"
        style={{
          left,
          top,
          width: '344px',
          maxHeight: 'calc(100vh - 16px)',
          overflowY: 'auto',
        }}
      >
        {/* Banner */}
        {bannerHash ? (
          <div
            className="h-20 bg-cover bg-center"
            style={{
              backgroundImage: `linear-gradient(135deg, rgba(20, 24, 38, 0.2) 0%, rgba(20, 24, 38, 0.45) 100%), url(/api/v1/users/${user.id}/banner)`,
            }}
          />
        ) : (
          <div
            className="h-16"
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-primary-hover) 100%)',
            }}
          />
        )}

        {/* Avatar + name */}
        <div className="px-7 pb-4">
          <div className="relative -mt-8 mb-3">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 text-xl font-bold text-white"
              style={{
                backgroundColor: 'var(--accent-primary)',
                borderColor: 'var(--bg-floating)',
              }}
            >
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div
              className="absolute bottom-0 right-0 w-5 h-5 rounded-full"
              style={{
                backgroundColor: STATUS_COLORS[status],
                borderColor: 'var(--bg-floating)',
                borderWidth: '3px',
                borderStyle: 'solid',
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              {user.display_name || user.username}
            </div>
            {isBotUser && (
              <span className="rounded-md border border-accent-primary/35 bg-accent-primary/12 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
                Bot
              </span>
            )}
          </div>
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {user.username}
          </div>
          {activityLabel && (
            <div className="mt-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {activityElapsed ? `${activityLabel} for ${activityElapsed}` : activityLabel}
            </div>
          )}
        </div>

        <div className="mx-7 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />

        {activityLabel && (
          <div className="px-7 pt-4 pb-2">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
              Activity
            </div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {activityLabel}
              {activityElapsed ? ` (${activityElapsed})` : ''}
            </div>
          </div>
        )}

        {/* About Me */}
        <div className="px-7 py-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
            About Me
          </div>
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {bio || 'No bio set.'}
          </div>
        </div>

        {/* Member Since */}
        {createdAt && (
          <div className="px-7 pb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
              Member Since
            </div>
            <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <CalendarDays size={13} />
              {formatDate(createdAt)}
            </div>
          </div>
        )}

        {/* Roles */}
        {displayRoles.length > 0 && (
          <div className="px-7 pb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
              Roles
            </div>
            <div className="flex flex-wrap gap-1.5">
              {displayRoles.map(role => (
                <span
                  key={role.id}
                  className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--bg-mod-subtle)',
                    color: intToHex(role.color),
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: intToHex(role.color) }}
                  />
                  {role.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Mutual Servers */}
        {mutualGuilds.length > 0 && (
          <div className="px-7 pb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
              Mutual Servers - {mutualGuilds.length}
            </div>
            <div className="flex flex-wrap gap-2">
              {mutualGuilds.slice(0, 6).map(guild => (
                <div
                  key={guild.id}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--bg-mod-subtle)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title={guild.name}
                >
                  <div
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    {guild.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="max-w-[100px] truncate">{guild.name}</span>
                </div>
              ))}
              {mutualGuilds.length > 6 && (
                <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  +{mutualGuilds.length - 6} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Mutual Friends */}
        {mutualFriends.length > 0 && (
          <div className="px-7 pb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
              <span className="inline-flex items-center gap-1.5">
                <Users size={12} />
                Mutual Friends - {mutualFriends.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {mutualFriends.slice(0, 6).map(friend => (
                <div
                  key={friend.id}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--bg-mod-subtle)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title={friend.username}
                >
                  <div
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    {friend.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="max-w-[100px] truncate">{friend.username}</span>
                </div>
              ))}
              {mutualFriends.length > 6 && (
                <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  +{mutualFriends.length - 6} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Note */}
        <div className="px-7 pb-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
            Note
          </div>
          <input
            type="text"
            placeholder="Click to add a note"
            className="h-10 w-full rounded-lg border border-border-subtle bg-bg-mod-subtle px-3 text-sm text-text-secondary outline-none transition-colors focus:border-border-strong focus:bg-bg-mod-strong"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-4 px-7 pb-5">
          <button className="btn-primary flex-1 items-center justify-center gap-1.5" onClick={() => void handleMessage()}>
            <MessageSquare size={14} />
            Message
          </button>
          {!isBotUser && (
            <button className="icon-btn border-border-subtle bg-bg-mod-subtle" title="Add Friend" onClick={() => void handleAddFriend()}>
              <UserPlus size={18} />
            </button>
          )}
          <button className="icon-btn border-border-subtle bg-bg-mod-subtle" title="Block" onClick={() => void handleBlock()}>
            <Ban size={18} />
          </button>
        </div>
        {actionError && (
          <div className="px-7 pb-5 text-xs font-medium" style={{ color: 'var(--accent-danger)' }}>
            {actionError}
          </div>
        )}
      </div>
    </>
  );
}
