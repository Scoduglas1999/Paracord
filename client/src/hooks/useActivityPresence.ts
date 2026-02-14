import { useEffect } from 'react';
import { gateway } from '../gateway/connection';
import { connectionManager } from '../lib/connectionManager';
import { isTauri } from '../lib/tauriEnv';
import {
  formatActivityLabel,
  normalizeDetectedAppId,
  readStringArray,
  readableAppName,
  recordKnownActivityApp,
} from '../lib/activityPresence';
import { useAuthStore } from '../stores/authStore';
import { usePresenceStore } from '../stores/presenceStore';
import type { Activity, Presence } from '../types';

const POLL_INTERVAL_MS = 5000;

interface ForegroundApplication {
  pid: number;
  process_name: string;
  display_name?: string | null;
  executable_path?: string | null;
  window_title?: string | null;
}

function mapStatusForPresence(status: string | undefined): Presence['status'] {
  if (status === 'idle' || status === 'dnd' || status === 'offline') return status;
  if (status === 'invisible') return 'offline';
  return 'online';
}

function isParacordProcess(app: ForegroundApplication): boolean {
  const signature = `${app.process_name} ${app.executable_path || ''}`.toLowerCase();
  return signature.includes('paracord');
}

function buildActivity(app: ForegroundApplication, startedAt: string, appId: string): Activity {
  const name = (app.display_name || '').trim() || readableAppName(app.process_name);
  const state = app.window_title?.trim() || undefined;
  return {
    name,
    type: 0,
    details: formatActivityLabel({ name, type: 0 }) || undefined,
    state,
    started_at: startedAt,
    application_id: appId,
  };
}

function publishPresence(status: Presence['status'], activities: Activity[]): void {
  const activeConnections = connectionManager.getAllConnections().filter((conn) => conn.connected);
  if (activeConnections.length > 0) {
    for (const conn of activeConnections) {
      connectionManager.updatePresence(conn.serverId, status, activities);
    }
  } else {
    gateway.updatePresence(status, activities);
  }

  const localUserId = useAuthStore.getState().user?.id;
  if (!localUserId) return;
  usePresenceStore.getState().updatePresence({
    user_id: localUserId,
    status,
    activities,
  });
}

export function useActivityPresence() {
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    if (!token || !isTauri()) return;

    let cancelled = false;
    let inFlight = false;
    let activeAppId: string | null = null;
    let startedAt: string | null = null;
    let lastPayloadSignature = '';

    const emit = (status: Presence['status'], activities: Activity[]) => {
      const signature = JSON.stringify({
        status,
        app: activities[0]?.application_id || null,
        started_at: activities[0]?.started_at || null,
      });
      if (signature === lastPayloadSignature) return;
      publishPresence(status, activities);
      lastPayloadSignature = signature;
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const detected = await invoke<ForegroundApplication | null>('get_foreground_application');
        if (cancelled) return;

        const settings = useAuthStore.getState().settings;
        const notifications = (settings?.notifications ?? {}) as Record<string, unknown>;
        const detectionEnabled = notifications['activityDetectionEnabled'] !== false;
        const disabledApps = new Set(
          readStringArray(notifications['activityDetectionDisabledApps']).map(normalizeDetectedAppId)
        );
        const status = mapStatusForPresence(settings?.status);

        const candidate =
          detected && detected.process_name && !isParacordProcess(detected) ? detected : null;
        const appId = candidate ? normalizeDetectedAppId(candidate.process_name) : '';

        if (appId) {
          recordKnownActivityApp(appId);
        }

        const shouldHideActivity =
          !detectionEnabled || status === 'offline' || !candidate || disabledApps.has(appId);
        if (shouldHideActivity) {
          activeAppId = null;
          startedAt = null;
          emit(status, []);
          return;
        }

        if (activeAppId !== appId || !startedAt) {
          activeAppId = appId;
          startedAt = new Date().toISOString();
        }

        emit(status, [buildActivity(candidate, startedAt, appId)]);
      } catch {
        // Ignore foreground detection failures and keep last known state.
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);
}
