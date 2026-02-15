import { beforeEach, describe, expect, it } from 'vitest';
import { usePresenceStore } from './presenceStore';

function resetStore(): void {
  usePresenceStore.setState({ presences: new Map() });
}

describe('presenceStore.getPresence', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns the exact scoped presence when available', () => {
    const store = usePresenceStore.getState();
    store.updatePresence({ user_id: 'u1', status: 'online', activities: [] }, 'server-a');
    const presence = usePresenceStore.getState().getPresence('u1', 'server-a');
    expect(presence?.status).toBe('online');
  });

  it('falls back to global presence when scoped presence is missing', () => {
    const store = usePresenceStore.getState();
    store.updatePresence({ user_id: 'u1', status: 'idle', activities: [] });
    const presence = usePresenceStore.getState().getPresence('u1', 'server-a');
    expect(presence?.status).toBe('idle');
  });

  it('falls back to the only known scoped presence when scope is unavailable', () => {
    const store = usePresenceStore.getState();
    store.updatePresence({ user_id: 'u1', status: 'dnd', activities: [] }, 'server-a');
    const presence = usePresenceStore.getState().getPresence('u1');
    expect(presence?.status).toBe('dnd');
  });

  it('returns undefined when multiple scoped presences exist and no scope is provided', () => {
    const store = usePresenceStore.getState();
    store.updatePresence({ user_id: 'u1', status: 'online', activities: [] }, 'server-a');
    store.updatePresence({ user_id: 'u1', status: 'idle', activities: [] }, 'server-b');
    const presence = usePresenceStore.getState().getPresence('u1');
    expect(presence).toBeUndefined();
  });
});
