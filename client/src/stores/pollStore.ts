import { create } from 'zustand';
import type { Poll } from '../types';

interface PollState {
  pollsById: Record<string, Poll>;
  upsertPoll: (poll: Poll) => void;
  clearPollsForChannel: (channelId: string) => void;
}

export const usePollStore = create<PollState>()((set) => ({
  pollsById: {},

  upsertPoll: (poll) =>
    set((state) => ({
      pollsById: {
        ...state.pollsById,
        [poll.id]: poll,
      },
    })),

  clearPollsForChannel: (channelId) =>
    set((state) => {
      const next = { ...state.pollsById };
      for (const [pollId, poll] of Object.entries(next)) {
        if (poll.channel_id === channelId) {
          delete next[pollId];
        }
      }
      return { pollsById: next };
    }),
}));
