import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, Smile, Send, X, FileText } from 'lucide-react';
import { useMessageStore } from '../../stores/messageStore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useTyping } from '../../hooks/useTyping';
import { MAX_MESSAGE_LENGTH } from '../../lib/constants';
import { EmojiPicker } from '../ui/EmojiPicker';

interface MessageInputProps {
  channelId: string;
  guildId?: string;
  channelName?: string;
  replyingTo?: { id: string; author: string; content: string } | null;
  onCancelReply?: () => void;
}

export function MessageInput({ channelId, guildId: _guildId, channelName, replyingTo, onCancelReply }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useFileUpload(channelId);
  const { triggerTyping } = useTyping(channelId);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.5) + 'px';
    }
  }, [content]);

  const stagedImagePreviews = useMemo(
    () =>
      stagedFiles.map((file) => (
        file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      )),
    [stagedFiles]
  );

  useEffect(() => {
    return () => {
      stagedImagePreviews.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [stagedImagePreviews]);

  const handleSubmit = async () => {
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setStagedFiles(prev => [...prev, ...files]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  return (
    <div
      className="relative px-2.5 pb-[calc(var(--safe-bottom)+0.65rem)] pt-1 sm:px-5 sm:pb-5"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Reply bar */}
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

      {/* Staged files */}
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
      {submitError && (
        <div className="mt-2 rounded-lg border border-accent-danger/40 bg-accent-danger/10 px-3 py-2 text-xs font-semibold" style={{ color: 'var(--accent-danger)' }}>
          {submitError}
        </div>
      )}

      {/* Input area */}
      <div
        className={`glass-panel flex min-h-[56px] items-end gap-1.5 rounded-2xl border bg-bg-primary/75 px-3 py-2.5 shadow-[0_8px_24px_rgba(4,8,18,0.35)] sm:min-h-[60px] sm:gap-2.5 sm:px-4 sm:py-3 ${
          isDragOver ? 'border-2 border-dashed border-accent-primary/70' : 'border-border-subtle'
        }`}
        style={{
          borderTopLeftRadius: (replyingTo || stagedFiles.length > 0) ? '0' : '1rem',
          borderTopRightRadius: (replyingTo || stagedFiles.length > 0) ? '0' : '1rem',
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          className="command-icon-btn mb-0.5 flex-shrink-0 border border-transparent text-text-secondary hover:border-border-subtle hover:text-text-primary"
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
          placeholder={`Message ${channelName ? '#' + channelName : 'this channel'}`}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          className="flex-1 resize-none bg-transparent py-1 text-sm leading-6 outline-none placeholder:text-text-muted"
          style={{
            color: 'var(--text-primary)',
            maxHeight: '50vh',
            lineHeight: '1.45rem',
          }}
        />
        <div className="relative">
          <button
            className="command-icon-btn mb-0.5 flex-shrink-0 border border-transparent text-text-secondary hover:border-border-subtle hover:text-text-primary"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
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
              />
            </div>
          )}
        </div>
        {(content.trim() || stagedFiles.length > 0) && (
          <button
            onClick={handleSubmit}
            disabled={uploading}
            className="command-icon-btn mb-0.5 flex-shrink-0 border border-accent-primary/45 bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 disabled:border-border-subtle disabled:bg-transparent disabled:text-text-muted"
          >
            <Send size={18} />
          </button>
        )}
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
