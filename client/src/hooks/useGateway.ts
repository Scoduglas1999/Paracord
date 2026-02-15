import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useServerListStore } from '../stores/serverListStore';
import { gateway } from '../gateway/connection';
import { connectionManager } from '../lib/connectionManager';

export function useGateway() {
  const token = useAuthStore((s) => s.token);
  const serverCount = useServerListStore((s) => s.servers.length);
  const serversHydrated = useServerListStore((s) => s.hydrated);

  useEffect(() => {
    if (!token) {
      gateway.disconnect();
      connectionManager.disconnectAll();
      return;
    }

    // Wait for persisted server-list state to hydrate before deciding between
    // legacy single-socket mode and per-server connectionManager mode.
    // This prevents startup oscillation and transient /gateway failures.
    if (!serversHydrated) {
      return;
    }

    // If there are any configured servers, always use connectionManager.
    // It can authenticate missing tokens and prevents startup bouncing
    // between legacy gateway and per-server sockets.
    if (serverCount > 0) {
      gateway.disconnect();
      connectionManager.connectAll().catch(() => {
        // Per-server errors are handled inside connectionManager.
      });
      return;
    }

    gateway.connect();

    return () => {
      gateway.disconnect();
    };
  }, [token, serverCount, serversHydrated]);
}
