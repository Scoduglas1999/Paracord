import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';

// Mock stores
const mockSendMessage = vi.fn();
const mockAddMessage = vi.fn();
vi.mock('../../stores/messageStore', () => ({
  useMessageStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        sendMessage: mockSendMessage,
        addMessage: mockAddMessage,
      }),
    },
  ),
}));

vi.mock('../../stores/channelStore', () => ({
  useChannelStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ channelsByGuild: { g1: [{ id: 'ch1', type: 0, channel_type: 0, guild_id: 'g1', name: 'general', position: 0 }] } }),
    {
      getState: () => ({
        channelsByGuild: { g1: [{ id: 'ch1', type: 0, channel_type: 0, guild_id: 'g1', name: 'general', position: 0 }] },
      }),
    },
  ),
}));

vi.mock('../../stores/pollStore', () => ({
  usePollStore: {
    getState: () => ({
      clearPollsForChannel: vi.fn(),
      upsertPoll: vi.fn(),
    }),
  },
}));

vi.mock('../../stores/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../hooks/useFileUpload', () => ({
  useFileUpload: () => ({ upload: vi.fn(), uploading: false }),
}));

vi.mock('../../hooks/useTyping', () => ({
  useTyping: () => ({ triggerTyping: vi.fn() }),
}));

vi.mock('../../api/channels', () => ({
  channelApi: {
    createPoll: vi.fn(),
  },
}));

vi.mock('./MarkdownToolbar', () => ({
  MarkdownToolbar: () => null,
  applyMarkdownToolbarAction: vi.fn(),
  resolveMarkdownShortcut: vi.fn(() => null),
}));

vi.mock('../ui/EmojiPicker', () => ({
  EmojiPicker: () => null,
}));

vi.mock('../../lib/constants', () => ({
  MAX_MESSAGE_LENGTH: 2000,
}));

describe('MessageInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it('renders a textarea with channel placeholder', () => {
    render(<MessageInput channelId="ch1" guildId="g1" channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('renders with default placeholder when no channel name', () => {
    render(<MessageInput channelId="ch1" guildId="g1" />);
    expect(screen.getByPlaceholderText('Message this channel')).toBeInTheDocument();
  });

  it('allows typing in the textarea', async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch1" guildId="g1" channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');

    await user.type(textarea, 'Hello world');
    expect(textarea).toHaveValue('Hello world');
  });

  it('sends message on Enter key', async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch1" guildId="g1" channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');

    await user.type(textarea, 'Hello');
    await user.keyboard('{Enter}');

    expect(mockSendMessage).toHaveBeenCalledWith('ch1', 'Hello', undefined, []);
  });

  it('does not send on Shift+Enter (allows newline)', async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch1" guildId="g1" channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');

    await user.type(textarea, 'Line 1');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not send empty message', async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch1" guildId="g1" channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');

    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('clears textarea after successful send', async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch1" guildId="g1" channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');

    await user.type(textarea, 'Test message');
    await user.keyboard('{Enter}');

    expect(textarea).toHaveValue('');
  });

  it('shows reply indicator when replyingTo is provided', () => {
    render(
      <MessageInput
        channelId="ch1"
        guildId="g1"
        channelName="general"
        replyingTo={{ id: 'm1', author: 'TestUser', content: 'Original message' }}
        onCancelReply={vi.fn()}
      />,
    );

    expect(screen.getByText('Replying to')).toBeInTheDocument();
    expect(screen.getByText('TestUser')).toBeInTheDocument();
    expect(screen.getByText('Original message')).toBeInTheDocument();
  });

  it('shows send button when content is typed', async () => {
    const user = userEvent.setup();
    render(<MessageInput channelId="ch1" guildId="g1" channelName="general" />);
    const textarea = screen.getByPlaceholderText('Message #general');

    await user.type(textarea, 'Some text');

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});
