import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownUp,
  Grid3X3,
  LayoutList,
  MessageSquare,
  Plus,
  Tag,
  X,
} from 'lucide-react';
import { channelApi } from '../../api/channels';
import type { Channel, ForumTag } from '../../types';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/toastStore';

interface ForumViewProps {
  channelId: string;
  channelName: string;
}

type ViewLayout = 'grid' | 'list';

export function ForumView({ channelId, channelName }: ForumViewProps) {
  const { guildId } = useParams();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<Channel[]>([]);
  const [tags, setTags] = useState<ForumTag[]>([]);
  const [sortOrder, setSortOrder] = useState(0);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<ViewLayout>('grid');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showNewPost, setShowNewPost] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await channelApi.getForumPosts(channelId, {
        sort_order: sortOrder,
        include_archived: includeArchived,
      });
      setPosts(data.posts || []);
      setTags(data.tags || []);
    } catch {
      toast.error('Failed to load forum posts');
    } finally {
      setLoading(false);
    }
  }, [channelId, sortOrder, includeArchived]);

  const fetchTags = useCallback(async () => {
    try {
      const { data } = await channelApi.getForumTags(channelId);
      setTags(data || []);
    } catch {
      // Tag permissions can fail for users without access; keep existing tags.
    }
  }, [channelId]);

  useEffect(() => {
    void Promise.all([fetchPosts(), fetchTags()]);
  }, [fetchPosts, fetchTags]);

  const filteredPosts =
    selectedTags.size === 0
      ? posts
      : posts.filter((post) => {
          const postTags: string[] = (post.applied_tags as string[] | null) ?? [];
          return postTags.some((t) => selectedTags.has(t));
        });

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const handlePostClick = (post: Channel) => {
    if (guildId) {
      navigate(`/app/guilds/${guildId}/channels/${post.id}`);
    }
  };

  const handleSortChange = async (newOrder: number) => {
    setSortOrder(newOrder);
    try {
      await channelApi.updateForumSortOrder(channelId, newOrder);
    } catch {
      // Ignore - local sort still applied via fetchPosts dependency
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle/70 px-4 py-3">
        {/* Sort */}
        <button
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-mod-subtle"
          onClick={() => void handleSortChange(sortOrder === 0 ? 1 : 0)}
          title={sortOrder === 0 ? 'Sorted by latest activity' : 'Sorted by creation date'}
        >
          <ArrowDownUp size={14} />
          {sortOrder === 0 ? 'Latest Activity' : 'Newest First'}
        </button>

        {/* Layout toggle */}
        <div className="flex items-center rounded-lg border border-border-subtle">
          <button
            className={cn(
              'flex items-center gap-1 rounded-l-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              layout === 'grid'
                ? 'bg-bg-mod-strong text-text-primary'
                : 'text-text-muted hover:text-text-secondary',
            )}
            onClick={() => setLayout('grid')}
            title="Grid view"
          >
            <Grid3X3 size={14} />
          </button>
          <button
            className={cn(
              'flex items-center gap-1 rounded-r-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              layout === 'list'
                ? 'bg-bg-mod-strong text-text-primary'
                : 'text-text-muted hover:text-text-secondary',
            )}
            onClick={() => setLayout('list')}
            title="List view"
          >
            <LayoutList size={14} />
          </button>
        </div>

        {/* Include archived */}
        <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded"
          />
          Archived
        </label>

        <div className="flex-1" />

        <button
          className="flex items-center gap-1.5 rounded-xl border border-border-subtle px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-mod-subtle"
          onClick={() => setShowTagManager(true)}
        >
          <Tag size={15} />
          Tags
        </button>

        {/* New Post button */}
        <button
          className="flex items-center gap-1.5 rounded-xl border border-accent-primary/50 bg-accent-primary/15 px-3.5 py-2 text-sm font-semibold text-accent-primary transition-colors hover:bg-accent-primary/25"
          onClick={() => setShowNewPost(true)}
        >
          <Plus size={16} />
          New Post
        </button>
      </div>

      {/* Tag filters */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle/50 px-4 py-2">
          <Tag size={13} className="text-text-muted" />
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                selectedTags.has(tag.id)
                  ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-primary'
                  : 'border-border-subtle text-text-secondary hover:border-border-strong hover:bg-bg-mod-subtle',
              )}
            >
              {tag.emoji && <span className="mr-1">{tag.emoji}</span>}
              {tag.name}
            </button>
          ))}
          {selectedTags.size > 0 && (
            <button
              onClick={() => setSelectedTags(new Set())}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Posts */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2"
              style={{
                borderColor: 'var(--text-muted)',
                borderTopColor: 'var(--accent-primary)',
              }}
            />
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-subtle bg-bg-mod-subtle">
              <MessageSquare size={28} className="text-text-muted" />
            </div>
            <p className="text-sm font-medium text-text-secondary">No posts yet</p>
            <p className="mt-1 text-xs text-text-muted">
              Be the first to start a conversation in #{channelName}
            </p>
          </div>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPosts.map((post) => (
              <PostCard key={post.id} post={post} tags={tags} onClick={() => handlePostClick(post)} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredPosts.map((post) => (
              <PostRow key={post.id} post={post} tags={tags} onClick={() => handlePostClick(post)} />
            ))}
          </div>
        )}
      </div>

      {/* New Post Modal */}
      {showNewPost && (
        <NewPostModal
          channelId={channelId}
          tags={tags}
          onClose={() => setShowNewPost(false)}
          onCreated={() => {
            setShowNewPost(false);
            void fetchPosts();
            void fetchTags();
          }}
        />
      )}

      {showTagManager && (
        <TagManagerModal
          channelId={channelId}
          tags={tags}
          onClose={() => setShowTagManager(false)}
          onChanged={() => {
            void fetchTags();
            void fetchPosts();
          }}
        />
      )}
    </div>
  );
}

function PostCard({
  post,
  tags,
  onClick,
}: {
  post: Channel;
  tags: ForumTag[];
  onClick: () => void;
}) {
  const postTags: string[] = (post.applied_tags as string[] | null) ?? [];
  const matchedTags = tags.filter((t) => postTags.includes(t.id));
  const isArchived = post.thread_metadata?.archived === true;

  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-xl border border-border-subtle bg-bg-mod-subtle/50 p-4 text-left transition-all hover:border-border-strong hover:bg-bg-mod-subtle"
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="flex-1 truncate text-sm font-semibold text-text-primary group-hover:text-accent-primary">
          {post.name || 'Untitled'}
        </span>
        {isArchived && (
          <span className="shrink-0 rounded bg-bg-mod-strong px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            Archived
          </span>
        )}
      </div>

      {matchedTags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {matchedTags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-medium text-text-muted"
            >
              {tag.emoji && <span className="mr-0.5">{tag.emoji}</span>}
              {tag.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 text-xs text-text-muted">
        {post.owner_id && (
          <span>by {post.owner_id.slice(0, 6)}...</span>
        )}
        <span className="flex items-center gap-1">
          <MessageSquare size={12} />
          {post.message_count ?? 0}
        </span>
        <span className="ml-auto">
          {new Date(post.created_at).toLocaleDateString()}
        </span>
      </div>
    </button>
  );
}

function PostRow({
  post,
  tags,
  onClick,
}: {
  post: Channel;
  tags: ForumTag[];
  onClick: () => void;
}) {
  const postTags: string[] = (post.applied_tags as string[] | null) ?? [];
  const matchedTags = tags.filter((t) => postTags.includes(t.id));
  const isArchived = post.thread_metadata?.archived === true;

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-bg-mod-subtle/30 px-4 py-3 text-left transition-all hover:border-border-strong hover:bg-bg-mod-subtle"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-text-primary group-hover:text-accent-primary">
            {post.name || 'Untitled'}
          </span>
          {isArchived && (
            <span className="shrink-0 rounded bg-bg-mod-strong px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
              Archived
            </span>
          )}
        </div>
        {matchedTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {matchedTags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-medium text-text-muted"
              >
                {tag.emoji && <span className="mr-0.5">{tag.emoji}</span>}
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <MessageSquare size={12} />
          {post.message_count ?? 0}
        </span>
        <span>{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
    </button>
  );
}

function TagManagerModal({
  channelId,
  tags,
  onClose,
  onChanged,
}: {
  channelId: string;
  tags: ForumTag[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);

  const createTag = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await channelApi.createForumTag(channelId, {
        name: trimmed,
        emoji: emoji.trim() || undefined,
      });
      setName('');
      setEmoji('');
      onChanged();
      toast.success('Tag created');
    } catch {
      toast.error('Failed to create tag');
    } finally {
      setCreating(false);
    }
  };

  const deleteTag = async (tagId: string) => {
    setDeletingTagId(tagId);
    try {
      await channelApi.deleteForumTag(channelId, tagId);
      onChanged();
      toast.success('Tag deleted');
    } catch {
      toast.error('Failed to delete tag');
    } finally {
      setDeletingTagId(null);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'var(--overlay-backdrop)' }}
        onClick={onClose}
      />
      <div className="glass-modal fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="text-lg font-semibold text-text-primary">Manage Forum Tags</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-mod-subtle hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              placeholder="Tag name"
              className="w-full rounded-xl border border-border-subtle bg-bg-mod-subtle px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong"
            />
            <input
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={16}
              placeholder="Emoji"
              className="w-full rounded-xl border border-border-subtle bg-bg-mod-subtle px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong"
            />
            <button
              onClick={() => void createTag()}
              disabled={creating || !name.trim()}
              className="rounded-xl border border-accent-primary/50 bg-accent-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {tags.length === 0 ? (
              <div className="rounded-xl border border-border-subtle bg-bg-mod-subtle/30 px-4 py-5 text-center text-sm text-text-muted">
                No tags yet.
              </div>
            ) : (
              tags.map((tag) => (
                <div key={tag.id} className="flex items-center justify-between rounded-xl border border-border-subtle bg-bg-mod-subtle/35 px-3 py-2">
                  <div className="text-sm text-text-primary">
                    {tag.emoji ? `${tag.emoji} ` : ''}
                    {tag.name}
                  </div>
                  <button
                    onClick={() => void deleteTag(tag.id)}
                    disabled={deletingTagId === tag.id}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-accent-danger transition-colors hover:bg-accent-danger/12 disabled:opacity-50"
                  >
                    {deletingTagId === tag.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function NewPostModal({
  channelId,
  tags,
  onClose,
  onCreated,
}: {
  channelId: string;
  tags: ForumTag[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    setSubmitting(true);
    try {
      await channelApi.createForumPost(channelId, {
        name: trimmed,
        content: content.trim() || undefined,
        applied_tag_ids: selectedTagIds.size > 0 ? Array.from(selectedTagIds) : undefined,
      });
      toast.success('Post created');
      onCreated();
    } catch {
      toast.error('Failed to create post');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'var(--overlay-backdrop)' }}
        onClick={onClose}
      />
      <div className="glass-modal fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="text-lg font-semibold text-text-primary">New Post</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-mod-subtle hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="Post title"
              className="w-full rounded-xl border border-border-subtle bg-bg-mod-subtle px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
              Content (optional)
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Write the first message of your post..."
              className="w-full resize-none rounded-xl border border-border-subtle bg-bg-mod-subtle px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong"
            />
          </div>

          {tags.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      selectedTagIds.has(tag.id)
                        ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-primary'
                        : 'border-border-subtle text-text-secondary hover:border-border-strong',
                    )}
                  >
                    {tag.emoji && <span className="mr-1">{tag.emoji}</span>}
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-border-subtle px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-mod-subtle"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!title.trim() || submitting}
            className="rounded-xl border border-accent-primary/50 bg-accent-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Post'}
          </button>
        </div>
      </div>
    </>
  );
}
