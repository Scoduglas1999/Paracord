import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { Role } from '../../types/index';
import { UserProfilePopup } from '../user/UserProfile';
import { useMemberStore } from '../../stores/memberStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useGuildStore } from '../../stores/guildStore';
import { useServerListStore } from '../../stores/serverListStore';
import { useAuthStore } from '../../stores/authStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { formatActivityLabel, getPrimaryActivity } from '../../lib/activityPresence';
import { SkeletonMember } from '../ui/Skeleton';

interface MemberWithUser {
  user_id: string;
  username: string;
  avatar_hash: string | null;
  nick: string | null;
  roles: string[];
  bot?: boolean;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  activityText?: string | null;
}

interface MemberListProps {
  members?: MemberWithUser[];
  roles?: Role[];
}

const STATUS_COLORS: Record<string, string> = {
  online: 'var(--status-online)',
  idle: 'var(--status-idle)',
  dnd: 'var(--status-dnd)',
  offline: 'var(--status-offline)',
};

export function resolveMemberStatus(
  presenceStatus: MemberWithUser['status'] | undefined,
  inCurrentGuildVoice: boolean,
  isAuthenticatedSelfMember: boolean,
): MemberWithUser['status'] {
  if (presenceStatus) return presenceStatus;
  if (isAuthenticatedSelfMember || inCurrentGuildVoice) return 'online';
  return 'offline';
}

export function MemberList({ members: propMembers, roles = [] }: MemberListProps) {
  const selectedGuildId = useGuildStore(s => s.selectedGuildId);
  const activeServerId = useServerListStore(s => s.activeServerId);
  const activeServer = useServerListStore((s) =>
    s.activeServerId ? s.servers.find((server) => server.id === s.activeServerId) : undefined
  );
  const authUserId = useAuthStore((s) => s.user?.id);
  const authToken = useAuthStore((s) => s.token);
  const storeMembers = useMemberStore(s => selectedGuildId ? s.members.get(selectedGuildId) : undefined);
  const fetchMembers = useMemberStore(s => s.fetchMembers);
  // Subscribe so presence updates trigger recomputation.
  const presences = usePresenceStore((s) => s.presences);
  const getPresence = usePresenceStore((s) => s.getPresence);
  const voiceParticipants = useVoiceStore((s) => s.participants);
  const selfUserId = activeServer?.userId ?? authUserId;
  const isAuthenticated = Boolean(authToken && selfUserId);

  useEffect(() => {
    if (selectedGuildId && !storeMembers) {
      fetchMembers(selectedGuildId);
    }
  }, [selectedGuildId]);

  const members: MemberWithUser[] = useMemo(() => {
    if (propMembers) return propMembers;
    return (storeMembers || []).map(m => {
      const presence = getPresence(m.user.id, activeServerId ?? undefined);
      const voiceState = voiceParticipants.get(m.user.id);
      const inCurrentGuildVoice =
        Boolean(voiceState?.channel_id) &&
        (!selectedGuildId || voiceState?.guild_id === selectedGuildId);
      const isAuthenticatedSelfMember = isAuthenticated && m.user.id === selfUserId;
      const derivedStatus = resolveMemberStatus(
        presence?.status as MemberWithUser['status'] | undefined,
        inCurrentGuildVoice,
        isAuthenticatedSelfMember,
      );
      const activity = getPrimaryActivity(presence);
      return {
        user_id: m.user.id,
        username: m.user.username,
        avatar_hash: m.user.avatar || null,
        nick: m.nick || null,
        roles: m.roles ?? [],
        bot: m.user.bot,
        status: derivedStatus,
        activityText: formatActivityLabel(activity),
      };
    });
  }, [propMembers, storeMembers, presences, getPresence, activeServerId, voiceParticipants, selectedGuildId, isAuthenticated, selfUserId]);
  const [showOffline, setShowOffline] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberWithUser | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const onlineMems = members.filter(m => m.status !== 'offline');
  const offlineMems = members.filter(m => m.status === 'offline');

  const roleGroups = new Map<string, MemberWithUser[]>();
  const noRoleGroup: MemberWithUser[] = [];

  onlineMems.forEach(m => {
    if (m.roles.length > 0 && roles.length > 0) {
      const highestRole = roles
        .filter(r => m.roles.includes(r.id))
        .sort((a, b) => b.position - a.position)[0];
      if (highestRole) {
        if (!roleGroups.has(highestRole.id)) roleGroups.set(highestRole.id, []);
        roleGroups.get(highestRole.id)!.push(m);
        return;
      }
    }
    noRoleGroup.push(m);
  });

  const handleMemberClick = (e: React.MouseEvent, member: MemberWithUser) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopupPos({ x: rect.left, y: rect.top });
    setSelectedMember(member);
  };

  const getStatusColor = (status?: string) => STATUS_COLORS[status || 'offline'];

  const renderMember = (member: MemberWithUser) => (
    <button
      key={member.user_id}
      className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-all hover:border-border-subtle hover:bg-bg-mod-subtle"
      onClick={(e) => handleMemberClick(e, member)}
    >
      <div className="relative flex-shrink-0">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{
            backgroundColor: 'var(--accent-primary)',
            opacity: member.status === 'offline' ? 0.4 : 1,
          }}
        >
          {(member.nick || member.username).charAt(0).toUpperCase()}
        </div>
        <div
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
          style={{
            backgroundColor: getStatusColor(member.status),
            borderColor: 'var(--bg-secondary)',
          }}
        />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className="truncate text-sm font-semibold text-text-secondary transition-colors group-hover:text-text-primary"
            style={{
              opacity: member.status === 'offline' ? 0.4 : 1,
            }}
          >
            {member.nick || member.username}
          </div>
          {member.bot && (
            <span className="shrink-0 rounded-md border border-accent-primary/35 bg-accent-primary/12 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
              Bot
            </span>
          )}
        </div>
        {member.activityText && member.status !== 'offline' && (
          <div className="truncate text-xs text-text-muted">{member.activityText}</div>
        )}
      </div>
    </button>
  );

  const isMemberListLoading = !propMembers && !storeMembers && !!selectedGuildId;

  return (
    <div
      className="flex flex-col overflow-y-auto scrollbar-thin"
      role="complementary"
      aria-label="Member list"
      style={{
        width: 'var(--member-list-width)',
        minWidth: 'var(--member-list-width)',
      }}
    >
      <div className="px-3 pt-4.5">
        {isMemberListLoading ? (
          <div aria-label="Loading members">
            {Array.from({ length: 7 }, (_, i) => (
              <SkeletonMember key={i} />
            ))}
          </div>
        ) : (
        <>
        <div className="mb-6 rounded-xl border border-border-subtle bg-bg-mod-subtle/60 px-3.5 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Members</div>
          <div className="mt-0.5 text-base font-semibold text-text-primary">{members.length}</div>
        </div>
        {Array.from(roleGroups.entries()).map(([roleId, groupMembers]) => {
          const role = roles.find(r => r.id === roleId);
          return (
            <div key={roleId} className="mt-6 mb-3">
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {role?.name || 'Members'} — {groupMembers.length}
              </div>
              <div className="space-y-1.5">
                {groupMembers.map(renderMember)}
              </div>
            </div>
          );
        })}

        {noRoleGroup.length > 0 && (
          <div className="mt-6 mb-3">
            <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Online — {noRoleGroup.length}
            </div>
            <div className="space-y-1.5">
              {noRoleGroup.map(renderMember)}
            </div>
          </div>
        )}

        {offlineMems.length > 0 && (
          <div className="mt-8 mb-3">
            <button
              className="category-header w-full rounded-lg px-3 py-2 hover:bg-bg-mod-subtle"
              onClick={() => setShowOffline(!showOffline)}
            >
              <ChevronDown
                size={12}
                className="transition-transform"
                style={{ transform: showOffline ? 'rotate(0deg)' : 'rotate(-90deg)' }}
              />
              Offline — {offlineMems.length}
            </button>
            {showOffline && (
              <div className="space-y-1.5">
                {offlineMems.map(renderMember)}
              </div>
            )}
          </div>
        )}

        {members.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <p className="text-xs text-center text-text-muted">No members to display</p>
          </div>
        )}
        </>
        )}
      </div>

      {selectedMember && createPortal(
        <UserProfilePopup
          user={{
            id: selectedMember.user_id,
            username: selectedMember.username,
            discriminator: '0000',
            avatar_hash: selectedMember.avatar_hash,
            display_name: selectedMember.nick,
            bot: selectedMember.bot ?? false,
            system: false,
            flags: 0,
            created_at: '',
          }}
          roles={roles.filter((role) => selectedMember.roles.includes(role.id))}
          position={popupPos}
          onClose={() => setSelectedMember(null)}
        />,
        document.body
      )}
    </div>
  );
}
