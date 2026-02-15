import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useGuildStore } from '../../stores/guildStore';
import { useChannelStore } from '../../stores/channelStore';
import { inviteApi } from '../../api/invites';
import { useNavigate } from 'react-router-dom';
import { isAllowedImageMimeType } from '../../lib/security';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface CreateGuildModalProps {
  onClose: () => void;
}

export function CreateGuildModal({ onClose }: CreateGuildModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [serverName, setServerName] = useState(`${user?.username || 'My'}'s server`);
  const [inviteCode, setInviteCode] = useState('');
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (iconPreview?.startsWith('blob:')) {
        URL.revokeObjectURL(iconPreview);
      }
    };
  }, [iconPreview]);

  useFocusTrap(dialogRef, true, onClose);

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!isAllowedImageMimeType(file.type)) {
        setError('Please upload PNG, JPG, GIF, or WEBP.');
        return;
      }
      setError('');
      const objectUrl = URL.createObjectURL(file);
      setIconPreview(objectUrl);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setIconDataUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreate = async () => {
    if (!serverName.trim()) return;
    setError('');
    setLoading(true);
    try {
      const guild = await useGuildStore.getState().createGuild(serverName.trim(), iconDataUrl || undefined);
      // Fetch channels so sidebar isn't empty
      await useChannelStore.getState().fetchChannels(guild.id);
      const channels = useChannelStore.getState().channelsByGuild[guild.id] || [];
      const firstChannel = channels.find(c => c.type === 0) || channels.find(c => c.type !== 4) || channels[0];
      onClose();
      if (firstChannel) {
        useChannelStore.getState().selectGuild(guild.id);
        useChannelStore.getState().selectChannel(firstChannel.id);
        navigate(`/app/guilds/${guild.id}/channels/${firstChannel.id}`);
      } else {
        navigate(`/app/guilds/${guild.id}/settings`);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create server');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    setError('');
    setLoading(true);
    try {
      const code = inviteCode.trim().split('/').pop() || inviteCode.trim();
      const { data } = await inviteApi.accept(code);
      const guild = 'guild' in data ? data.guild : data;
      useGuildStore.getState().addGuild(guild);
      await useChannelStore.getState().fetchChannels(guild.id);
      const channels = useChannelStore.getState().channelsByGuild[guild.id] || [];
      const firstChannelId =
        guild.default_channel_id ||
        channels.find(c => c.type === 0)?.id ||
        channels.find(c => c.type !== 4)?.id ||
        channels[0]?.id;
      onClose();
      if (firstChannelId) {
        useChannelStore.getState().selectGuild(guild.id);
        useChannelStore.getState().selectChannel(firstChannelId);
        navigate(`/app/guilds/${guild.id}/channels/${firstChannelId}`);
      } else {
        navigate(`/app/guilds/${guild.id}/settings`);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to join server');
    } finally {
      setLoading(false);
    }
  };

  const modal = (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100dvh' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-guild-modal-title"
        tabIndex={-1}
        className="glass-modal modal-content max-h-[min(86dvh,42rem)] w-[min(92vw,32rem)] overflow-auto rounded-2xl border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-8 pb-5 pt-8 text-center sm:px-8 sm:pb-5 sm:pt-8">
          <button onClick={onClose} className="icon-btn absolute right-3 top-3 sm:right-5 sm:top-5" aria-label="Close">
            <X size={20} />
          </button>
          <h2 id="create-guild-modal-title" className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {tab === 'create' ? 'Create a Server' : 'Join a Server'}
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {tab === 'create'
              ? 'Your server is where you and your friends hang out.'
              : 'Enter an invite below to join an existing server.'}
          </p>

          {error && (
            <p className="mt-3 rounded-xl border border-accent-danger/35 bg-accent-danger/10 px-3 py-2 text-sm font-medium" style={{ color: 'var(--accent-danger)' }}>{error}</p>
          )}

          {/* Tab switcher */}
          <div className="mt-5 flex gap-2 rounded-xl p-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <button
              className={`tab-btn flex-1 py-2 ${tab === 'create' ? 'active' : ''}`}
              style={tab === 'create' ? { backgroundColor: 'var(--bg-primary)' } : {}}
              onClick={() => setTab('create')}
            >
              Create
            </button>
            <button
              className={`tab-btn flex-1 py-2 ${tab === 'join' ? 'active' : ''}`}
              style={tab === 'join' ? { backgroundColor: 'var(--bg-primary)' } : {}}
              onClick={() => setTab('join')}
            >
              Join
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 pb-8 sm:px-8 sm:pb-8">
          {tab === 'create' ? (
            <div className="space-y-6">
              <div className="flex justify-center">
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={handleIconChange} />
                  <div
                    className="flex h-24 w-24 flex-col items-center justify-center rounded-full border-2 border-dashed transition-colors"
                    style={{
                      borderColor: 'var(--interactive-muted)',
                      backgroundColor: iconPreview ? 'transparent' : 'var(--bg-secondary)',
                    }}
                  >
                    {iconPreview ? (
                      <img src={iconPreview} alt="Icon" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <>
                        <Upload size={22} style={{ color: 'var(--text-muted)' }} />
                        <span className="text-[10px] mt-0.5 font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>
                          Upload
                        </span>
                      </>
                    )}
                  </div>
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                  Server Name
                </span>
                <input
                  type="text"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  className="input-field mt-3"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-6">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                  Invite Link
                </span>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="https://paracord.gg/hTKzmak"
                  className="input-field mt-3"
                />
              </label>
              <div className="rounded-xl border border-border-subtle bg-bg-mod-subtle/65 px-3.5 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                  Invites should look like
                </span>
                <div className="mt-1.5 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
                  hTKzmak<br />
                  https://paracord.gg/hTKzmak
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex flex-col-reverse items-stretch gap-5 border-t border-border-subtle/70 px-8 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={tab === 'create' ? handleCreate : handleJoin}
            disabled={loading}
            className="btn-primary min-w-[9rem]"
          >
            {loading ? 'Working...' : tab === 'create' ? 'Create' : 'Join Server'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
