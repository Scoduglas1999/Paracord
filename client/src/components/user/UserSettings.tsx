import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Monitor, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useAccountStore } from '../../stores/accountStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useMediaDevices } from '../../hooks/useMediaDevices';
import { APP_NAME } from '../../lib/constants';
import { hasAccount as hasLocalCryptoAccount } from '../../lib/account';
import { isAdmin } from '../../types';
import { adminApi } from '../../api/admin';
import { cn } from '../../lib/utils';
import {
  getKnownActivityAppsFromStorage,
  normalizeDetectedAppId,
  readStringArray,
  readableAppName,
  saveKnownActivityAppsToStorage,
} from '../../lib/activityPresence';

interface UserSettingsProps {
  onClose: () => void;
}

type SettingsSection =
  | 'account'
  | 'appearance'
  | 'voice'
  | 'notifications'
  | 'activity'
  | 'keybinds'
  | 'about'
  | 'server';

const NAV_ITEMS: { id: SettingsSection; label: string; adminOnly?: boolean }[] = [
  { id: 'account', label: 'My Account' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'voice', label: 'Voice & Video' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'activity', label: 'Activity Privacy' },
  { id: 'keybinds', label: 'Keybinds' },
  { id: 'server', label: 'Server', adminOnly: true },
  { id: 'about', label: 'About' },
];

export function UserSettings({ onClose }: UserSettingsProps) {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SettingsSection>('account');
  const user = useAuthStore(s => s.user);
  const settings = useAuthStore(s => s.settings);
  const logout = useAuthStore(s => s.logout);
  const fetchSettings = useAuthStore(s => s.fetchSettings);
  const updateSettings = useAuthStore(s => s.updateSettings);
  const updateUser = useAuthStore(s => s.updateUser);
  const accountPublicKey = useAccountStore((s) => s.publicKey);
  const accountUnlocked = useAccountStore((s) => s.isUnlocked);
  const setThemeUI = useUIStore((s) => s.setTheme);
  const [theme, setTheme] = useState<'dark' | 'light' | 'amoled'>('dark');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [locale, setLocale] = useState('en-US');
  const [messageCompact, setMessageCompact] = useState(false);
  const [notifications, setNotifications] = useState<Record<string, unknown>>({});
  const [knownActivityApps, setKnownActivityApps] = useState<string[]>([]);
  const [keybinds, setKeybinds] = useState<Record<string, unknown>>({});
  const [capturingKeybind, setCapturingKeybind] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const cryptoAuthEnabled = settings?.crypto_auth_enabled === true;
  const {
    audioInputDevices,
    audioOutputDevices,
    selectedAudioInput,
    selectedAudioOutput,
    selectAudioInput,
    selectAudioOutput,
    enumerate,
  } = useMediaDevices();
  const applyAudioInputDevice = useVoiceStore((s) => s.applyAudioInputDevice);
  const applyAudioOutputDevice = useVoiceStore((s) => s.applyAudioOutputDevice);
  const userIsAdmin = user ? isAdmin(user.flags ?? 0) : false;
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const localCryptoAccountReady = Boolean(accountPublicKey) || hasLocalCryptoAccount();
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });

  useEffect(() => {
    void fetchSettings();
  }, []);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '');
      setBio(user.bio || '');
    }
  }, [user?.id, user?.display_name, user?.bio]);

  useEffect(() => {
    if (settings) {
      const notif = settings.notifications as Record<string, unknown> | undefined;
      const knownFromSettings = readStringArray(notif?.['activityDetectionKnownApps']).map(
        normalizeDetectedAppId
      );
      const knownFromStorage = getKnownActivityAppsFromStorage().map(normalizeDetectedAppId);
      const known = Array.from(new Set([...knownFromSettings, ...knownFromStorage])).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      const disabledApps = readStringArray(notif?.['activityDetectionDisabledApps']).map(
        normalizeDetectedAppId
      );

      setTheme(settings.theme);
      setLocale(settings.locale || 'en-US');
      setMessageCompact(settings.message_display_compact || false);
      setKnownActivityApps(known);
      setNotifications({
        ...(settings.notifications as Record<string, unknown>),
        activityDetectionEnabled: notif?.['activityDetectionEnabled'] !== false,
        activityDetectionKnownApps: known,
        activityDetectionDisabledApps: Array.from(new Set(disabledApps)).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        ),
      });
      setKeybinds((settings.keybinds as Record<string, unknown>) || {});
      if (typeof notif?.['audioInputDeviceId'] === 'string') {
        selectAudioInput(notif['audioInputDeviceId'] as string);
      }
      if (typeof notif?.['audioOutputDeviceId'] === 'string') {
        selectAudioOutput(notif['audioOutputDeviceId'] as string);
      }
    }
  }, [settings]);

  useEffect(() => {
    if (activeSection !== 'voice') return;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return enumerate();
      })
      .catch(() => {
        /* ignore permission denial */
      });
  }, [activeSection, enumerate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateIsMobile = () => setIsMobile(mediaQuery.matches);
    updateIsMobile();
    mediaQuery.addEventListener('change', updateIsMobile);
    return () => mediaQuery.removeEventListener('change', updateIsMobile);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  const handleThemeChange = (newTheme: 'dark' | 'light' | 'amoled') => {
    setTheme(newTheme);
    setThemeUI(newTheme);
  };

  const mergedNotifications = useMemo<Record<string, unknown>>(
    () => ({
      desktop: true,
      messageSound: true,
      ...notifications,
    }),
    [notifications]
  );

  const mergedKeybinds = useMemo<Record<string, unknown>>(
    () => ({
      toggleMute: 'Ctrl+Shift+M',
      toggleDeafen: 'Ctrl+Shift+D',
      pushToTalk: 'Not set',
      ...keybinds,
    }),
    [keybinds]
  );

  const activityDetectionEnabled = mergedNotifications['activityDetectionEnabled'] !== false;
  const disabledActivityApps = useMemo(
    () =>
      new Set(
        readStringArray(mergedNotifications['activityDetectionDisabledApps']).map(
          normalizeDetectedAppId
        )
      ),
    [mergedNotifications]
  );
  const visibleKnownActivityApps = useMemo(() => {
    const knownFromNotifications = readStringArray(
      mergedNotifications['activityDetectionKnownApps']
    ).map(normalizeDetectedAppId);
    return Array.from(new Set([...knownActivityApps, ...knownFromNotifications])).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [knownActivityApps, mergedNotifications]);

  useEffect(() => {
    if (activeSection !== 'activity') return;
    const syncDetectedApps = () => {
      const latest = getKnownActivityAppsFromStorage().map(normalizeDetectedAppId);
      const merged = Array.from(new Set([...latest, ...visibleKnownActivityApps])).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      setKnownActivityApps((prev) => {
        if (prev.length === merged.length && prev.every((value, index) => value === merged[index])) {
          return prev;
        }
        return merged;
      });
    };

    syncDetectedApps();
    const timer = window.setInterval(syncDetectedApps, 2000);
    return () => window.clearInterval(timer);
  }, [activeSection, visibleKnownActivityApps]);

  const saveProfile = async () => {
    setSaving(true);
    setStatusText(null);
    try {
      await updateUser({
        display_name: displayName || undefined,
        bio: bio || undefined,
      });
      setStatusText('Profile updated.');
    } catch {
      setStatusText('Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setStatusText(null);
    try {
      await updateSettings({
        theme,
        locale,
        message_display_compact: messageCompact,
        crypto_auth_enabled: cryptoAuthEnabled,
        notifications: {
          ...mergedNotifications,
          audioInputDeviceId: selectedAudioInput,
          audioOutputDeviceId: selectedAudioOutput,
        },
        keybinds: mergedKeybinds,
      });
      setThemeUI(theme);
      setStatusText('Settings saved.');
    } catch {
      setStatusText('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const setActivityDetectionEnabled = (enabled: boolean) => {
    setNotifications((prev) => ({
      ...prev,
      activityDetectionEnabled: enabled,
      activityDetectionKnownApps: visibleKnownActivityApps,
    }));
  };

  const toggleActivityApp = (appId: string) => {
    const normalized = normalizeDetectedAppId(appId);
    setNotifications((prev) => {
      const disabled = new Set(
        readStringArray(prev['activityDetectionDisabledApps']).map(normalizeDetectedAppId)
      );
      if (disabled.has(normalized)) {
        disabled.delete(normalized);
      } else {
        disabled.add(normalized);
      }
      return {
        ...prev,
        activityDetectionKnownApps: visibleKnownActivityApps,
        activityDetectionDisabledApps: Array.from(disabled).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        ),
      };
    });
  };

  const saveActivitySettings = async () => {
    saveKnownActivityAppsToStorage(visibleKnownActivityApps);
    await saveSettings();
  };

  const handleCryptoSecurityToggle = async (enabled: boolean) => {
    if (!localCryptoAccountReady) return;
    setSaving(true);
    try {
      await updateSettings({
        theme,
        locale,
        message_display_compact: messageCompact,
        crypto_auth_enabled: enabled,
        notifications: {
          ...mergedNotifications,
          audioInputDeviceId: selectedAudioInput,
          audioOutputDeviceId: selectedAudioOutput,
        },
        keybinds: mergedKeybinds,
      });
      setStatusText(enabled ? 'Device crypto security enabled.' : 'Device crypto security disabled.');
    } catch {
      setStatusText('Failed to update device crypto security.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-bg-tertiary/95 backdrop-blur-sm',
        isMobile ? 'flex flex-col' : 'flex'
      )}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full blur-[120px]" style={{ backgroundColor: 'var(--ambient-glow-primary)' }} />
      <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full blur-[140px]" style={{ backgroundColor: 'var(--ambient-glow-success)' }} />

      {isMobile ? (
        <div className="relative z-10 border-b border-border-subtle/70 bg-bg-secondary/70 px-3 pb-2.5 pt-[calc(var(--safe-top)+0.75rem)]">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">User Settings</div>
            <button onClick={onClose} className="command-icon-btn h-9 w-9 rounded-full border border-border-strong bg-bg-secondary/75">
              <X size={17} />
            </button>
          </div>
          <div className="scrollbar-thin flex items-center gap-2 overflow-x-auto pb-1">
            {NAV_ITEMS.filter(item => !item.adminOnly || userIsAdmin).map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors',
                  activeSection === item.id
                    ? 'border-border-strong bg-bg-mod-strong text-text-primary'
                    : 'border-border-subtle/70 bg-bg-mod-subtle text-text-secondary'
                )}
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={() => { logout(); onClose(); }}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-accent-danger/45 bg-accent-danger/10 px-3 text-sm font-semibold text-accent-danger"
            >
              Log Out
            </button>
          </div>
        </div>
      ) : (
        <div className="relative z-10 w-72 shrink-0 overflow-y-auto border-r border-border-subtle/70 bg-bg-secondary/65 px-4 py-10">
          <div className="ml-auto w-full max-w-[236px]">
            <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              User Settings
            </div>
            {NAV_ITEMS.filter(item => !item.adminOnly || userIsAdmin).map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`settings-nav-item ${activeSection === item.id ? 'active' : ''}`}
              >
                {item.label}
              </button>
            ))}
            <div className="mx-2 my-2 h-px bg-border-subtle" />
            <button
              onClick={() => { logout(); onClose(); }}
              className="settings-nav-item"
              style={{ color: 'var(--accent-danger)', borderColor: 'transparent' }}
            >
              Log Out
            </button>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className={cn('relative z-10 flex-1 overflow-y-auto', isMobile ? 'px-3 pb-[calc(var(--safe-bottom)+1rem)] pt-3' : 'px-6 py-10')}>
        <div className="w-full">
        {/* Close button */}
        {!isMobile && (
          <div className="fixed right-6 top-5 z-20 flex flex-col items-center gap-1">
            <button onClick={onClose} className="command-icon-btn rounded-full border border-border-strong bg-bg-secondary/75">
              <X size={18} />
            </button>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Esc</span>
          </div>
        )}
        {statusText && (
          <div
            className="card-surface mb-8 inline-flex max-w-full items-center rounded-xl border border-border-subtle bg-bg-mod-subtle px-4 py-3 text-sm font-medium"
            style={{ color: statusText.includes('Failed') ? 'var(--accent-danger)' : 'var(--accent-success)' }}
          >
            {statusText}
          </div>
        )}

        {activeSection === 'account' && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)] !p-0 overflow-hidden">
            <div className="p-8 pb-0">
              <h2 className="settings-section-title mb-8">My Account</h2>
            </div>
            <div>
              <div
                className="h-28"
                style={{ background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-primary-hover) 100%)' }}
              />
              <div className="px-8 pb-8">
                <div className="-mt-9 mb-12 flex items-end">
                  <div
                    className="flex h-20 w-20 items-center justify-center rounded-full border-4 text-2xl font-bold text-white"
                    style={{ backgroundColor: 'var(--accent-primary)', borderColor: 'var(--bg-secondary)' }}
                  >
                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span className="ml-3 text-xl font-bold text-text-primary">
                    {user?.username || 'User'}
                  </span>
                </div>
                <div className="card-stack-roomy">
                  <div
                    className="card-surface card-stack-relaxed rounded-2xl border border-border-subtle bg-bg-tertiary/80 p-8"
                  >
                    <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/55 px-6 py-5">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Username</div>
                      <div className="text-sm font-medium text-text-primary">{user?.username || 'Unknown'}</div>
                    </div>
                    <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/55 px-6 py-5">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Display Name</div>
                      <input className="input-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                    </div>
                    <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/55 px-6 py-5">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Bio</div>
                      <textarea className="input-field resize-none" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
                    </div>
                    <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/55 px-6 py-5">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Email</div>
                      <div className="text-sm font-medium text-text-primary">
                        {user?.email ? user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '***@***'}
                      </div>
                    </div>
                    <div className="settings-action-row">
                      <button className="btn-primary" onClick={() => void saveProfile()} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Profile'}
                      </button>
                    </div>
                  </div>

                  <div className="card-surface rounded-2xl border border-border-subtle bg-bg-tertiary/80 p-4 sm:p-5">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="card-surface min-h-[5.25rem] rounded-xl border border-border-subtle bg-bg-mod-subtle/80 px-6 py-5">
                        <div className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Theme</div>
                        <div className="mt-1 text-base font-semibold text-text-primary">{theme.toUpperCase()}</div>
                      </div>
                      <div className="card-surface min-h-[5.25rem] rounded-xl border border-border-subtle bg-bg-mod-subtle/80 px-6 py-5">
                        <div className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Locale</div>
                        <div className="mt-1 text-base font-semibold text-text-primary">{locale}</div>
                      </div>
                      <div className="card-surface min-h-[5.25rem] rounded-xl border border-border-subtle bg-bg-mod-subtle/80 px-6 py-5">
                        <div className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Message Density</div>
                        <div className="mt-1 text-base font-semibold text-text-primary">
                          {messageCompact ? 'Compact' : 'Comfortable'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card-surface rounded-2xl border border-border-subtle bg-bg-tertiary/80 p-8">
                    <div className="card-stack-relaxed">
                      <div className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                            Device Crypto Security (Optional)
                          </div>
                          <div className="mt-1 text-sm text-text-muted">
                            When enabled, this account can use local key unlock and challenge-response sign-in.
                          </div>
                        </div>
                        <ToggleSwitch
                          on={cryptoAuthEnabled}
                          onToggle={() => handleCryptoSecurityToggle(!cryptoAuthEnabled)}
                          disabled={!localCryptoAccountReady || saving}
                        />
                      </div>

                      {!localCryptoAccountReady && (
                        <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-6">
                          <div className="text-sm text-text-muted">
                            You have not set up a local crypto identity for this account yet.
                          </div>
                          <div className="settings-action-row">
                            <button
                              className="btn-primary"
                              onClick={() => {
                                onClose();
                                navigate('/setup?migrate=1');
                              }}
                            >
                              Set Up Local Identity
                            </button>
                          </div>
                        </div>
                      )}

                      {localCryptoAccountReady && (
                        <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-6 text-sm">
                          {cryptoAuthEnabled ? (
                            <span className="text-text-primary">
                              Security mode is enabled. {accountUnlocked ? 'Identity is currently unlocked.' : 'Identity is currently locked.'}
                            </span>
                          ) : (
                            <span className="text-text-muted">
                              Security mode is disabled. This account signs in with username/password only.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'appearance' && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)]">
            <h2 className="settings-section-title mb-8">Appearance</h2>
            <div className="mb-8">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Theme</div>
              <div className="grid gap-5 sm:grid-cols-3">
                {[
                  { id: 'dark' as const, label: 'Dark', icon: <Moon size={20} /> },
                  { id: 'light' as const, label: 'Light', icon: <Sun size={20} /> },
                  { id: 'amoled' as const, label: 'AMOLED', icon: <Monitor size={20} /> },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleThemeChange(t.id)}
                    className="card-surface flex flex-col items-center gap-2.5 rounded-xl border px-6 py-5 transition-colors"
                    style={{
                      backgroundColor: theme === t.id ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                      color: theme === t.id ? '#fff' : 'var(--text-secondary)',
                      borderColor: theme === t.id ? 'var(--accent-primary)' : 'var(--border-subtle)',
                    }}
                  >
                    {t.icon}
                    <span className="text-sm font-medium">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="card-stack-relaxed">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Locale</span>
                <input className="input-field mt-3" value={locale} onChange={(e) => setLocale(e.target.value)} />
              </label>
              <div className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                <div>
                  <div className="text-sm font-medium text-text-primary">Compact Message Display</div>
                </div>
                <ToggleSwitch on={messageCompact} onToggle={() => setMessageCompact(!messageCompact)} />
              </div>
            </div>
            <div className="settings-action-row">
              <button className="btn-primary" onClick={() => void saveSettings()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Appearance'}
              </button>
            </div>
          </div>
        )}

        {activeSection === 'voice' && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)]">
            <h2 className="settings-section-title mb-8">Voice & Video</h2>
            <div className="card-stack">
              <label className="card-surface block rounded-xl border border-border-subtle bg-bg-mod-subtle/55 px-6 py-5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Input Device</span>
                <select
                  className="select-field mt-3"
                  value={selectedAudioInput || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    selectAudioInput(value);
                    void applyAudioInputDevice(value || null);
                  }}
                >
                  <option value="">Default</option>
                  {audioInputDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="card-surface block rounded-xl border border-border-subtle bg-bg-mod-subtle/55 px-6 py-5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Output Device</span>
                <select
                  className="select-field mt-3"
                  value={selectedAudioOutput || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    selectAudioOutput(value);
                    void applyAudioOutputDevice(value || null);
                  }}
                >
                  <option value="">Default</option>
                  {audioOutputDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Speaker ${device.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                <div>
                  <div className="text-sm font-medium text-text-primary">Noise Suppression</div>
                  <div className="text-xs text-text-muted">Reduces background noise</div>
                </div>
                <ToggleSwitch
                  on={Boolean(mergedNotifications['noiseSuppression'] ?? true)}
                  onToggle={() => setNotifications((prev) => ({ ...prev, noiseSuppression: !Boolean(prev['noiseSuppression'] ?? true) }))}
                />
              </div>
              <div className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                <div>
                  <div className="text-sm font-medium text-text-primary">Echo Cancellation</div>
                  <div className="text-xs text-text-muted">Reduces echo from speakers</div>
                </div>
                <ToggleSwitch
                  on={Boolean(mergedNotifications['echoCancellation'] ?? true)}
                  onToggle={() => setNotifications((prev) => ({ ...prev, echoCancellation: !Boolean(prev['echoCancellation'] ?? true) }))}
                />
              </div>
              <div className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                <div>
                  <div className="text-sm font-medium text-text-primary">Automatic Gain Control</div>
                  <div className="text-xs text-text-muted">Normalizes mic volume (can add noise on some setups)</div>
                </div>
                <ToggleSwitch
                  on={Boolean(mergedNotifications['autoGainControl'] ?? false)}
                  onToggle={() => setNotifications((prev) => ({ ...prev, autoGainControl: !Boolean(prev['autoGainControl'] ?? false) }))}
                />
              </div>
            </div>
            <div className="settings-action-row">
              <button className="btn-primary" onClick={() => {
                void saveSettings().then(() => {
                  // Re-acquire the microphone with updated noise suppression /
                  // echo cancellation / auto gain constraints so changes take effect
                  // immediately without requiring a mute/unmute cycle.
                  void useVoiceStore.getState().reapplyAudioConstraints();
                });
              }} disabled={saving}>
                {saving ? 'Saving...' : 'Save Voice Settings'}
              </button>
            </div>
          </div>
        )}

        {activeSection === 'notifications' && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)]">
            <h2 className="settings-section-title mb-8">Notifications</h2>
            <div className="card-stack">
              <div className="card-surface flex items-center justify-between rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                <div>
                  <div className="text-sm font-medium text-text-primary">Desktop Notifications</div>
                  <div className="text-xs text-text-muted">Show desktop notifications for new messages</div>
                </div>
                <ToggleSwitch
                  on={Boolean(mergedNotifications.desktop)}
                  onToggle={() => setNotifications((prev) => ({ ...prev, desktop: !Boolean(prev.desktop) }))}
                />
              </div>
              <div className="card-surface flex items-center justify-between rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                <div>
                  <div className="text-sm font-medium text-text-primary">Message Sound</div>
                  <div className="text-xs text-text-muted">Play a sound for incoming messages</div>
                </div>
                <ToggleSwitch
                  on={Boolean(mergedNotifications.messageSound)}
                  onToggle={() => setNotifications((prev) => ({ ...prev, messageSound: !Boolean(prev.messageSound) }))}
                />
              </div>
            </div>
            <div className="settings-action-row">
              <button className="btn-primary" onClick={() => void saveSettings()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Notifications'}
              </button>
            </div>
          </div>
        )}

        {activeSection === 'activity' && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)]">
            <h2 className="settings-section-title mb-8">Activity Privacy</h2>
            <div className="card-stack">
              <div className="card-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-5">
                <div>
                  <div className="text-sm font-medium text-text-primary">Display current activity</div>
                  <div className="text-xs text-text-muted">
                    Show the game/app you are currently using in presence.
                  </div>
                </div>
                <ToggleSwitch
                  on={Boolean(activityDetectionEnabled)}
                  onToggle={() => setActivityDetectionEnabled(!Boolean(activityDetectionEnabled))}
                />
              </div>

              <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-6">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Detected Apps
                </div>
                <div className="mb-3 text-xs text-text-muted">
                  Disable any detected app to prevent Paracord from reporting it.
                </div>
                {visibleKnownActivityApps.length === 0 ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-tertiary/70 px-3 py-2.5 text-sm text-text-muted">
                    No apps detected yet. Launch a game/app while Paracord is open.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visibleKnownActivityApps.map((appId) => {
                      const enabled = !disabledActivityApps.has(appId);
                      return (
                        <div
                          key={appId}
                          className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-tertiary/70 px-3 py-2.5"
                        >
                          <div>
                            <div className="text-sm font-medium text-text-primary">{readableAppName(appId)}</div>
                            <div className="text-xs text-text-muted">{appId}</div>
                          </div>
                          <ToggleSwitch on={enabled} onToggle={() => toggleActivityApp(appId)} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="settings-action-row">
              <button className="btn-primary" onClick={() => void saveActivitySettings()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Activity Privacy'}
              </button>
            </div>
          </div>
        )}

        {activeSection === 'keybinds' && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)]">
            <h2 className="settings-section-title mb-8">Keybinds</h2>
            <div className="card-stack">
              {[
                { key: 'toggleMute' as const, action: 'Toggle Mute' },
                { key: 'toggleDeafen' as const, action: 'Toggle Deafen' },
                { key: 'pushToTalk' as const, action: 'Push to Talk' },
              ].map(kb => (
                <div
                  key={kb.key}
                  className="card-surface flex flex-col items-stretch gap-2 rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-6 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm font-medium text-text-primary">{kb.action}</span>
                  <input
                    className="h-10 w-full rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2 text-sm font-mono text-text-muted outline-none focus:border-accent-primary sm:w-48"
                    value={capturingKeybind === kb.key ? 'Press keys...' : String(mergedKeybinds[kb.key] ?? '')}
                    onFocus={() => setCapturingKeybind(kb.key)}
                    onBlur={() => setCapturingKeybind(null)}
                    onKeyDown={(e) => {
                      e.preventDefault();
                      const keys: string[] = [];
                      if (e.ctrlKey) keys.push('Ctrl');
                      if (e.shiftKey) keys.push('Shift');
                      if (e.altKey) keys.push('Alt');
                      if (e.metaKey) keys.push('Meta');
                      const base = e.key.length === 1 ? e.key.toUpperCase() : e.key;
                      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(base)) {
                        keys.push(base);
                      }
                      if (keys.length > 0) {
                        setKeybinds((prev) => ({ ...prev, [kb.key]: keys.join('+') }));
                        setCapturingKeybind(null);
                      }
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="settings-action-row">
              <button className="btn-primary" onClick={() => void saveSettings()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Keybinds'}
              </button>
            </div>
          </div>
        )}

        {activeSection === 'server' && userIsAdmin && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)]">
            <h2 className="settings-section-title mb-8">Server</h2>
            <div className="card-stack">
              <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Update & Restart</div>
                <div className="mt-2 text-sm text-text-muted">
                  Pull the latest code from git, rebuild the client and server, then restart. All connected users will be temporarily disconnected.
                </div>
                <div className="mt-4">
                  {!restartConfirm ? (
                    <button
                      className="btn-primary"
                      style={{ backgroundColor: 'var(--accent-warning, #f59e0b)' }}
                      onClick={() => setRestartConfirm(true)}
                      disabled={restarting}
                    >
                      Update & Restart Server
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium text-text-primary">Are you sure?</span>
                      <button
                        className="btn-primary"
                        style={{ backgroundColor: 'var(--accent-danger)' }}
                        disabled={restarting}
                        onClick={async () => {
                          setRestarting(true);
                          try {
                            await adminApi.restartUpdate();
                          } catch {
                            setRestarting(false);
                            setRestartConfirm(false);
                            setStatusText('Failed to trigger restart.');
                          }
                        }}
                      >
                        {restarting ? 'Restarting...' : 'Yes, restart now'}
                      </button>
                      <button
                        className="btn-primary"
                        style={{ backgroundColor: 'var(--bg-tertiary)' }}
                        onClick={() => setRestartConfirm(false)}
                        disabled={restarting}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'about' && (
          <div className="settings-surface-card w-full min-h-[calc(100dvh-13.5rem)]">
            <h2 className="settings-section-title mb-8">About</h2>
            <div className="card-stack">
              <div className="card-surface rounded-xl border border-border-subtle bg-bg-mod-subtle/70 px-6 py-6">
                <div className="text-sm font-semibold text-text-primary">{APP_NAME}</div>
                <div className="mt-1 text-xs text-text-muted">Version 0.4.0</div>
              </div>
              <div className="text-sm leading-6 text-text-muted">
                A decentralized, self-hostable Discord alternative built with Rust, Tauri, and React.
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className="relative h-6 w-11 rounded-full border transition-colors"
      style={{
        backgroundColor: disabled
          ? 'var(--interactive-muted)'
          : on
            ? 'var(--accent-success)'
            : 'var(--interactive-muted)',
        borderColor: on ? 'color-mix(in srgb, var(--accent-success) 75%, white 25%)' : 'var(--border-subtle)',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <div
        className="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all"
        style={{ left: on ? '18px' : '2px' }}
      />
    </button>
  );
}

