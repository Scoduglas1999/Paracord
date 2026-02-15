import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, Smile, Send, X, FileText, BarChart3, PlusCircle, MinusCircle } from 'lucide-react';
import { useMessageStore } from '../../stores/messageStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useTyping } from '../../hooks/useTyping';
import { MAX_MESSAGE_LENGTH } from '../../lib/constants';
import { EmojiPicker } from '../ui/EmojiPicker';
import { channelApi } from '../../api/channels';
import { usePollStore } from '../../stores/pollStore';
import { useChannelStore } from '../../stores/channelStore';
import { MarkdownToolbar, applyMarkdownToolbarAction, resolveMarkdownShortcut } from './MarkdownToolbar';

interface MessageInputProps {
  channelId: string;
  guildId?: string;
  channelName?: string;
  replyingTo?: { id: string; author: string; content: string } | null;
  onCancelReply?: () => void;
}

const POLL_DURATION_OPTIONS = [
  { label: 'No end time', minutes: 0 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '1 day', minutes: 1440 },
  { label: '3 days', minutes: 4320 },
  { label: '7 days', minutes: 10080 },
  { label: '14 days', minutes: 20160 },
];

export function MessageInput({ channelId, guildId, channelName, replyingTo, onCancelReply }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPollComposer, setShowPollComposer] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollAllowMultiselect, setPollAllowMultiselect] = useState(false);
  const [pollDurationMinutes, setPollDurationMinutes] = useState(1440);
  const [creatingPoll, setCreatingPoll] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useFileUpload(channelId);
  const { triggerTyping } = useTyping(channelId);
  const channelsByGuild = useChannelStore((s) => s.channelsByGuild);
  const activeChannel = useMemo(
    () => Object.values(channelsByGuild).flat().find((channel) => channel.id === channelId),
    [channelsByGuild, channelId],
  );
  const activeChannelType = activeChannel?.channel_type ?? activeChannel?.type;
  const canCreatePoll = activeChannelType == null || (activeChannelType !== 2 && activeChannelType !== 4);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.5) + 'px';
    }
  }, [content]);

  useEffect(() => {
    setShowPollComposer(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollAllowMultiselect(false);
    setPollDurationMinutes(1440);
    setCreatingPoll(false);
    setSubmitError(null);
  }, [channelId]);

  const stagedImagePreviews = useMemo(
    () =>
      stagedFiles.map((file) => (
        file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      )),
    [stagedFiles],
  );

  useEffect(() => {
    return () => {
      stagedImagePreviews.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [stagedImagePreviews]);

  const resetPollComposer = () => {
    setShowPollComposer(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollAllowMultiselect(false);
    setPollDurationMinutes(1440);
    setCreatingPoll(false);
  };

  const handleSubmit = async () => {
    if (showPollComposer) {
      const question = pollQuestion.trim();
      const options = pollOptions.map((opt) => opt.trim()).filter(Boolean);

      if (!question || question.length > 300) {
        setSubmitError('Poll question must be between 1 and 300 characters.');
        return;
      }
      if (options.length < 2 || options.length > 10) {
        setSubmitError('Polls require between 2 and 10 options.');
        return;
      }
      if (options.some((opt) => opt.length > 100)) {
        setSubmitError('Poll options must be 100 characters or less.');
        return;
      }

      try {
        setSubmitError(null);
        setCreatingPoll(true);
        const { data } = await channelApi.createPoll(channelId, {
          question,
          options: options.map((text) => ({ text })),
          allow_multiselect: pollAllowMultiselect,
          expires_in_minutes: pollDurationMinutes > 0 ? pollDurationMinutes : undefined,
        });
        if (data.poll) {
          usePollStore.getState().upsertPoll(data.poll);
        }
        useMessageStore.getState().addMessage(channelId, data);
        onCancelReply?.();
        resetPollComposer();
      } catch (err) {
        const responseData = (err as { response?: { data?: { message?: string; error?: string } } }).response?.data;
        setSubmitError(responseData?.message || responseData?.error || 'Failed to create poll.');
      } finally {
        setCreatingPoll(false);
      }
      return;
    }

    if (!content.trim() && stagedFiles.length === 0) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      setSubmitError(`Message is too long (${content.length}/${MAX_MESSAGE_LENGTH}).`);
      return;
    }
    try {
      setSubmitError(null);
      const attachmentIds: string[] = [];
      for (const file of stagedFiles) {
        const uploaded = await upload(file);
        if (uploaded?.id) {
          attachmentIds.push(uploaded.id);
        }
      }
      await useMessageStore.getState().sendMessage(
        channelId,
        content.trim(),
        replyingTo?.id,
        attachmentIds,
      );
      setContent('');
      setStagedFiles([]);
      onCancelReply?.();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch {
      setSubmitError('Failed to send message.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const markdownShortcut = resolveMarkdownShortcut(e);
      if (markdownShortcut) {
        e.preventDefault();
        e.stopPropagation();
        applyMarkdownToolbarAction(markdownShortcut, textarea, setContent);
        triggerTyping();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (showPollComposer) {
      setSubmitError('Disable poll composer before adding attachments.');
      return;
    }
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setStagedFiles(prev => [...prev, ...files]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (showPollComposer) {
      setSubmitError('Disable poll composer before adding attachments.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setStagedFiles(prev => [...prev, ...files]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setStagedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const togglePollComposer = () => {
    if (!canCreatePoll) return;
    if (showPollComposer) {
      resetPollComposer();
      setSubmitError(null);
      return;
    }
    if (stagedFiles.length > 0) {
      setSubmitError('Remove file attachments before creating a poll.');
      return;
    }
    if (!pollQuestion.trim() && content.trim()) {
      setPollQuestion(content.trim().slice(0, 300));
      setContent('');
    }
    setShowPollComposer(true);
    setSubmitError(null);
  };

  const updatePollOption = (index: number, value: string) => {
    setPollOptions((prev) => prev.map((option, optionIndex) => (
      optionIndex === index ? value : option
    )));
  };

  const removePollOption = (index: number) => {
    setPollOptions((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, optionIndex) => optionIndex !== index);
    });
  };

  const addPollOption = () => {
    setPollOptions((prev) => {
      if (prev.length >= 10) return prev;
      return [...prev, ''];
    });
  };

  return (
    <div
      className="relative px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2 sm:px-5 sm:pb-5"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {replyingTo && (
        <div className="flex flex-wrap items-center gap-2 rounded-t-2xl border border-b-0 border-border-subtle bg-bg-mod-subtle px-3 py-2 text-xs text-text-muted sm:px-4 sm:py-2.5 sm:text-sm">
          <span>Replying to</span>
          <span style={{ color: 'var(--text-primary)' }} className="font-medium">{replyingTo.author}</span>
          <span className="truncate flex-1" style={{ color: 'var(--text-muted)' }}>{replyingTo.content}</span>
          <button onClick={onCancelReply} className="command-icon-btn h-8 w-8">
            <X size={16} />
          </button>
        </div>
      )}

      {stagedFiles.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto border border-b-0 border-border-subtle bg-bg-mod-subtle px-3 py-2.5 sm:px-4 sm:py-3"
          style={{
            borderTopLeftRadius: replyingTo ? '0' : '1rem',
            borderTopRightRadius: replyingTo ? '0' : '1rem',
          }}
        >
          {stagedFiles.map((file, i) => (
            <div
              key={i}
              className="group relative flex flex-shrink-0 items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-primary/70 p-2.5"
              style={{
                maxWidth: 'min(180px, 48vw)',
              }}
            >
              {file.type.startsWith('image/') ? (
                <img
                  src={stagedImagePreviews[i] || ''}
                  alt={file.name}
                  className="h-16 w-16 rounded-md object-cover"
                />
              ) : (
                <FileText size={24} style={{ color: 'var(--text-muted)' }} />
              )}
              <div className="min-w-0">
                <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{file.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatFileSize(file.size)}</div>
              </div>
              <button
                onClick={() => removeFile(i)}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border-subtle opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                style={{ backgroundColor: 'var(--accent-danger)', color: '#fff' }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showPollComposer && (
        <div
          className="border border-b-0 border-border-subtle bg-bg-mod-subtle px-3 py-3 sm:px-4 sm:py-3.5"
          style={{
            borderTopLeftRadius: (replyingTo || stagedFiles.length > 0) ? '0' : '1rem',
            borderTopRightRadius: (replyingTo || stagedFiles.length > 0) ? '0' : '1rem',
          }}
        >
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              <BarChart3 size={13} />
              Poll
            </span>
            <button
              type="button"
              onClick={togglePollComposer}
              className="rounded-md border border-border-subtle px-2 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:text-text-primary"
            >
              Close
            </button>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Question</span>
            <input
              type="text"
              maxLength={300}
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-lg border border-border-subtle bg-bg-primary/80 px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary/45"
              placeholder="Ask a question..."
            />
          </label>

          <div className="mt-3 flex flex-col gap-2">
            {pollOptions.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={option}
                  maxLength={100}
                  onChange={(e) => updatePollOption(index, e.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border-subtle bg-bg-primary/80 px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary/45"
                  placeholder={`Option ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removePollOption(index)}
                  disabled={pollOptions.length <= 2}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle text-text-muted transition-colors hover:text-text-primary disabled:opacity-50"
                  aria-label={`Remove option ${index + 1}`}
                >
                  <MinusCircle size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={addPollOption}
              disabled={pollOptions.length >= 10}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
            >
              <PlusCircle size={13} />
              Add Option
            </button>
            <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={pollAllowMultiselect}
                onChange={(e) => setPollAllowMultiselect(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border-subtle bg-bg-primary"
              />
              Allow multiple answers
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <span>Duration</span>
              <select
                value={pollDurationMinutes}
                onChange={(e) => setPollDurationMinutes(Number(e.target.value))}
                className="h-8 rounded-md border border-border-subtle bg-bg-primary/80 px-2 text-xs text-text-primary outline-none transition-colors focus:border-accent-primary/45"
              >
                {POLL_DURATION_OPTIONS.map((option) => (
                  <option key={option.minutes} value={option.minutes}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {submitError && (
        <div className="mt-2 rounded-lg border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-xs font-semibold" style={{ color: 'var(--accent-danger)' }}>
          {submitError}
        </div>
      )}

      <div
        className={`glass-panel flex min-h-[56px] flex-col gap-2 rounded-2xl border bg-bg-primary/75 px-3 py-3 shadow-md sm:min-h-[60px] sm:gap-2.5 sm:px-4 sm:py-3.5 ${
          isDragOver ? 'border-2 border-dashed border-accent-primary/70' : 'border-border-subtle'
        }`}
        style={{
          borderTopLeftRadius: (replyingTo || stagedFiles.length > 0 || showPollComposer) ? '0' : '1rem',
          borderTopRightRadius: (replyingTo || stagedFiles.length > 0 || showPollComposer) ? '0' : '1rem',
        }}
      >
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle/60 bg-bg-mod-subtle/35 px-1.5 py-1">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <MarkdownToolbar textareaRef={textareaRef} onContentChange={setContent} />
          </div>
          {canCreatePoll && (
            <button
              type="button"
              onClick={togglePollComposer}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                showPollComposer
                  ? 'border-accent-primary/40 bg-accent-primary/12 text-accent-primary'
                  : 'border-border-subtle text-text-muted hover:text-text-primary'
              }`}
              title={showPollComposer ? 'Poll composer enabled' : 'Create a poll'}
            >
              <BarChart3 size={12} />
              <span className="hidden sm:inline">Poll</span>
            </button>
          )}
        </div>

        <div className="flex min-h-[42px] items-end gap-2">
          <button
            onClick={() => {
              if (showPollComposer) {
                setSubmitError('Disable poll composer before adding attachments.');
                return;
              }
              fileInputRef.current?.click();
            }}
            className="command-icon-btn mb-0.5 flex-shrink-0 border border-transparent text-text-secondary hover:border-border-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={showPollComposer}
          >
            <Plus size={20} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              triggerTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder={showPollComposer ? 'Poll question above will be sent as a poll message' : `Message ${channelName ? '#' + channelName : 'this channel'}`}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={showPollComposer}
            className="flex-1 resize-none bg-transparent py-1 text-sm leading-6 outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-70"
            style={{
              color: 'var(--text-primary)',
              maxHeight: '50vh',
              lineHeight: '1.45rem',
            }}
          />
          <div className="relative">
            <button
              className="command-icon-btn mb-0.5 flex-shrink-0 border border-transparent text-text-secondary hover:border-border-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              disabled={showPollComposer}
            >
              <Smile size={20} />
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-2 max-w-[90vw]" style={{ zIndex: 50 }}>
                <EmojiPicker
                  onSelect={(emoji) => {
                    setContent((prev) => `${prev}${emoji}`);
                    triggerTyping();
                    setShowEmojiPicker(false);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                  guildId={guildId}
                />
              </div>
            )}
          </div>
          {(showPollComposer || content.trim() || stagedFiles.length > 0) && (
            <button
              onClick={() => void handleSubmit()}
              disabled={uploading || creatingPoll}
              className="command-icon-btn mb-0.5 flex-shrink-0 border border-accent-primary/45 bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 disabled:border-border-subtle disabled:bg-transparent disabled:text-text-muted"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>

      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-primary/50 bg-bg-primary/60 backdrop-blur-sm">
          <div className="text-lg font-semibold" style={{ color: 'var(--accent-primary)' }}>
            Drop files to upload
          </div>
        </div>
      )}
    </div>
  );
}
