import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ServerConnectPage } from './pages/ServerConnectPage';
import { AccountSetupPage } from './pages/AccountSetupPage';
import { AccountUnlockPage } from './pages/AccountUnlockPage';
import { AccountRecoverPage } from './pages/AccountRecoverPage';
import { AppLayout } from './pages/AppLayout';
import { GuildPage } from './pages/GuildPage';
import { DMPage } from './pages/DMPage';
import { FriendsPage } from './pages/FriendsPage';
import { SettingsPage } from './pages/SettingsPage';
import { GuildSettingsPage } from './pages/GuildSettingsPage';
import { AdminPage } from './pages/AdminPage';
import { InvitePage } from './pages/InvitePage';
import { TermsPage } from './pages/TermsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { useAccountStore } from './stores/accountStore';
import { useServerListStore } from './stores/serverListStore';
import { useAuthStore } from './stores/authStore';
import { hasAccount } from './lib/account';
import { getStoredServerUrl } from './lib/apiBaseUrl';
import { connectionManager } from './lib/connectionManager';

/**
 * Checks whether we need a server URL configured before proceeding.
 * Now also considers the multi-server server list.
 */
function useServerStatus() {
  const servers = useServerListStore((s) => s.servers);
  const [status, setStatus] = useState<'loading' | 'ready' | 'needed'>(() => {
    if (servers.length > 0) return 'ready';
    if (getStoredServerUrl()) return 'ready';
    if (import.meta.env.VITE_API_URL || import.meta.env.VITE_WS_URL) return 'ready';
    return 'loading';
  });

  useEffect(() => {
    if (status !== 'loading') return;

    let cancelled = false;
    fetch('/health', { signal: AbortSignal.timeout(5_000) })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.service === 'paracord') {
          setStatus('ready');
        } else {
          setStatus('needed');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('needed');
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  return status;
}

/**
 * Route guard for the main app.
 *
 * Default mode is username/password auth. Device key unlock is only enforced
 * when the user has explicitly enabled crypto auth in server-side account settings.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isUnlocked = useAccountStore((s) => s.isUnlocked);
  const servers = useServerListStore((s) => s.servers);
  const token = useAuthStore((s) => s.token);
  const settings = useAuthStore((s) => s.settings);
  const hasFetchedSettings = useAuthStore((s) => s.hasFetchedSettings);
  const fetchSettings = useAuthStore((s) => s.fetchSettings);
  const serverStatus = useServerStatus();
  const cryptoAuthEnabled = settings?.crypto_auth_enabled === true;

  useEffect(() => {
    if (token && !hasFetchedSettings) {
      void fetchSettings();
    }
  }, [token, hasFetchedSettings, fetchSettings]);

  if (serverStatus === 'loading') {
    return (
      <div className="auth-shell">
        <p className="text-text-muted">Connecting...</p>
      </div>
    );
  }

  if (token && !hasFetchedSettings) {
    return (
      <div className="auth-shell">
        <p className="text-text-muted">Loading account settings...</p>
      </div>
    );
  }

  // Optional crypto-auth mode (server-controlled, default false).
  if (cryptoAuthEnabled) {
    if (!hasAccount()) {
      return <Navigate to="/setup" />;
    }
    if (!isUnlocked) {
      return <Navigate to="/unlock" />;
    }
    if (servers.length > 0 || (token && serverStatus === 'ready')) {
      return <>{children}</>;
    }
    if (!token) {
      return <Navigate to="/login" />;
    }
    if (servers.length === 0 && serverStatus !== 'ready') {
      return <Navigate to="/connect" />;
    }
    return <Navigate to="/connect" />;
  }

  // Password mode: valid token can enter directly.
  if (token && serverStatus === 'ready') {
    return <>{children}</>;
  }

  // Password mode without token.
  if (serverStatus === 'needed') {
    return <Navigate to="/connect" />;
  }
  return <Navigate to="/login" />;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const serverStatus = useServerStatus();

  if (serverStatus === 'loading') {
    return (
      <div className="auth-shell">
        <p className="text-text-muted">Connecting...</p>
      </div>
    );
  }

  if (serverStatus === 'needed') {
    return <Navigate to="/connect" />;
  }

  return <>{children}</>;
}

/**
 * Hook to auto-connect to all servers when account is unlocked.
 */
function useAutoConnect() {
  const isUnlocked = useAccountStore((s) => s.isUnlocked);
  const cryptoAuthEnabled = useAuthStore((s) => s.settings?.crypto_auth_enabled === true);
  const servers = useServerListStore((s) => s.servers);

  useEffect(() => {
    if (!cryptoAuthEnabled || !isUnlocked || servers.length === 0) return;
    connectionManager.connectAll().catch(() => {
      // Individual server connection errors are handled per-server.
    });
    return () => {
      connectionManager.disconnectAll();
    };
  }, [cryptoAuthEnabled, isUnlocked, servers.length]);
}

export default function App() {
  useAutoConnect();

  return (
    <Routes>
      {/* Optional device crypto identity */}
      <Route path="/setup" element={<AccountSetupPage />} />
      <Route path="/unlock" element={<AccountUnlockPage />} />
      <Route path="/recover" element={<AccountRecoverPage />} />

      {/* Server connection */}
      <Route path="/connect" element={<ServerConnectPage />} />

      {/* Password auth */}
      <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
      <Route path="/register" element={<AuthRoute><RegisterPage /></AuthRoute>} />

      {/* Invites, legal */}
      <Route path="/invite/:code" element={<InvitePage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />

      {/* Main app */}
      <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<FriendsPage />} />
        <Route path="guilds/:guildId/channels/:channelId" element={<GuildPage />} />
        <Route path="dms" element={<DMPage />} />
        <Route path="dms/:channelId" element={<DMPage />} />
        <Route path="friends" element={<FriendsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="guilds/:guildId/settings" element={<GuildSettingsPage />} />
      </Route>

      {/* Default: send to app (which handles auth redirects) */}
      <Route path="*" element={<Navigate to="/app" />} />
    </Routes>
  );
}
