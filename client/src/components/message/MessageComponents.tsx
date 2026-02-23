import { useState, useRef, useEffect, useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
import { ComponentType, ButtonStyle, type Component } from '../../types/components';
import { InteractionType } from '../../types/interactions';
import { apiClient } from '../../api/client';

interface MessageComponentsProps {
  components: Component[];
  messageId: string;
  channelId: string;
}

/** Dispatch a MessageComponent interaction to the server. */
async function dispatchComponentInteraction(
  channelId: string,
  messageId: string,
  customId: string,
  componentType: ComponentType,
  values?: string[],
): Promise<void> {
  await apiClient.post('/interactions', {
    type: InteractionType.MessageComponent,
    channel_id: channelId,
    message_id: messageId,
    data: {
      custom_id: customId,
      component_type: componentType,
      values,
    },
  });
}

// ---------------------------------------------------------------------------
// Button Component
// ---------------------------------------------------------------------------

const BUTTON_STYLE_CLASSES: Record<number, string> = {
  [ButtonStyle.Primary]:
    'bg-blue-600 hover:bg-blue-700 text-white border-blue-600',
  [ButtonStyle.Secondary]:
    'bg-gray-600 hover:bg-gray-700 text-white border-gray-600',
  [ButtonStyle.Success]:
    'bg-green-600 hover:bg-green-700 text-white border-green-600',
  [ButtonStyle.Danger]:
    'bg-red-600 hover:bg-red-700 text-white border-red-600',
  [ButtonStyle.Link]:
    'bg-transparent hover:underline text-text-link border-transparent',
};

function ComponentButton({
  component,
  channelId,
  messageId,
}: {
  component: Component;
  channelId: string;
  messageId: string;
}) {
  const [busy, setBusy] = useState(false);

  const style = component.style ?? ButtonStyle.Secondary;
  const isLink = style === ButtonStyle.Link;
  const isDisabled = component.disabled || busy;

  const baseClasses =
    'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors';
  const styleClasses = BUTTON_STYLE_CLASSES[style] ?? BUTTON_STYLE_CLASSES[ButtonStyle.Secondary];
  const disabledClasses = isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer';

  const handleClick = async () => {
    if (isDisabled) return;

    if (isLink && component.url) {
      window.open(component.url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (!component.custom_id) return;
    setBusy(true);
    try {
      await dispatchComponentInteraction(
        channelId,
        messageId,
        component.custom_id,
        ComponentType.Button,
      );
    } catch {
      // interaction errors are non-fatal
    } finally {
      setBusy(false);
    }
  };

  const emoji = component.emoji;
  const emojiRender = emoji ? (
    <span className="text-base leading-none">
      {emoji.id ? (
        <img
          src={`/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`}
          alt={emoji.name || ''}
          className="inline-block h-4 w-4"
        />
      ) : (
        emoji.name
      )}
    </span>
  ) : null;

  return (
    <button
      type="button"
      className={`${baseClasses} ${styleClasses} ${disabledClasses}`}
      onClick={() => void handleClick()}
      disabled={isDisabled}
      title={component.label || component.custom_id || undefined}
    >
      {emojiRender}
      {component.label && <span>{component.label}</span>}
      {isLink && <ExternalLink size={12} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// String Select Menu
// ---------------------------------------------------------------------------

function StringSelectMenu({
  component,
  channelId,
  messageId,
}: {
  component: Component;
  channelId: string;
  messageId: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedValues, setSelectedValues] = useState<string[]>(() => {
    return (component.options || []).filter((o) => o.default).map((o) => o.value);
  });
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = component.options || [];
  const minValues = component.min_values ?? 1;
  const maxValues = component.max_values ?? 1;
  const isMulti = maxValues > 1;
  const isDisabled = component.disabled || busy;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleOption = useCallback(
    (value: string) => {
      setSelectedValues((prev) => {
        if (isMulti) {
          if (prev.includes(value)) {
            return prev.filter((v) => v !== value);
          }
          if (prev.length >= maxValues) return prev;
          return [...prev, value];
        }
        return [value];
      });
    },
    [isMulti, maxValues],
  );

  const submitSelection = async () => {
    if (!component.custom_id || isDisabled) return;
    if (selectedValues.length < minValues) return;

    setBusy(true);
    setOpen(false);
    try {
      await dispatchComponentInteraction(
        channelId,
        messageId,
        component.custom_id,
        ComponentType.StringSelect,
        selectedValues,
      );
    } catch {
      // non-fatal
    } finally {
      setBusy(false);
    }
  };

  const handleOptionClick = (value: string) => {
    if (isMulti) {
      toggleOption(value);
    } else {
      setSelectedValues([value]);
      // Auto-submit for single select
      if (!component.custom_id || isDisabled) return;
      setBusy(true);
      setOpen(false);
      void dispatchComponentInteraction(
        channelId,
        messageId,
        component.custom_id!,
        ComponentType.StringSelect,
        [value],
      ).catch(() => {}).finally(() => setBusy(false));
    }
  };

  const displayText =
    selectedValues.length > 0
      ? options
          .filter((o) => selectedValues.includes(o.value))
          .map((o) => o.label)
          .join(', ')
      : component.placeholder || 'Make a selection...';

  return (
    <div ref={containerRef} className="relative inline-block min-w-[12rem] max-w-[25rem]">
      <button
        type="button"
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-primary/80 px-3 py-2 text-left text-sm transition-colors ${
          isDisabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:border-border-subtle/80 hover:bg-bg-mod-subtle'
        }`}
        onClick={() => {
          if (!isDisabled) setOpen((prev) => !prev);
        }}
        disabled={isDisabled}
      >
        <span
          className={`truncate ${
            selectedValues.length > 0 ? 'text-text-primary' : 'text-text-muted'
          }`}
        >
          {displayText}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border-subtle bg-bg-floating shadow-lg">
          {options.map((option) => {
            const isSelected = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-bg-mod-subtle ${
                  isSelected ? 'bg-accent-primary/10 text-text-primary' : 'text-text-secondary'
                }`}
                onClick={() => handleOptionClick(option.value)}
              >
                <div className="flex items-center gap-2">
                  {isMulti && (
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs ${
                        isSelected
                          ? 'border-accent-primary bg-accent-primary text-white'
                          : 'border-border-subtle bg-transparent'
                      }`}
                    >
                      {isSelected ? '\u2713' : ''}
                    </span>
                  )}
                  <span className="truncate font-medium">{option.label}</span>
                </div>
                {option.description && (
                  <span className="text-xs text-text-muted">{option.description}</span>
                )}
              </button>
            );
          })}

          {isMulti && (
            <div className="border-t border-border-subtle px-3 py-2">
              <button
                type="button"
                className={`w-full rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  selectedValues.length >= minValues
                    ? 'bg-accent-primary text-white hover:bg-accent-primary/90'
                    : 'cursor-not-allowed bg-gray-600 text-gray-400 opacity-50'
                }`}
                onClick={() => void submitSelection()}
                disabled={selectedValues.length < minValues}
              >
                Confirm ({selectedValues.length} selected)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder for unimplemented select types (UserSelect, RoleSelect, etc.)
// ---------------------------------------------------------------------------

function PlaceholderSelect({ component }: { component: Component }) {
  const typeLabels: Record<number, string> = {
    [ComponentType.UserSelect]: 'User Select',
    [ComponentType.RoleSelect]: 'Role Select',
    [ComponentType.MentionableSelect]: 'Mentionable Select',
    [ComponentType.ChannelSelect]: 'Channel Select',
  };

  return (
    <div className="inline-flex min-w-[12rem] items-center gap-2 rounded-md border border-border-subtle bg-bg-primary/80 px-3 py-2 text-sm text-text-muted opacity-60">
      <span>{component.placeholder || typeLabels[component.type] || 'Select'}</span>
      <span className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        TODO
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Row
// ---------------------------------------------------------------------------

function ActionRow({
  component,
  channelId,
  messageId,
}: {
  component: Component;
  channelId: string;
  messageId: string;
}) {
  const children = component.components || [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {children.map((child, index) => {
        const key = child.custom_id || `comp-${index}`;

        switch (child.type) {
          case ComponentType.Button:
            return (
              <ComponentButton
                key={key}
                component={child}
                channelId={channelId}
                messageId={messageId}
              />
            );
          case ComponentType.StringSelect:
            return (
              <StringSelectMenu
                key={key}
                component={child}
                channelId={channelId}
                messageId={messageId}
              />
            );
          case ComponentType.UserSelect:
          case ComponentType.RoleSelect:
          case ComponentType.MentionableSelect:
          case ComponentType.ChannelSelect:
            return <PlaceholderSelect key={key} component={child} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level Message Components
// ---------------------------------------------------------------------------

export function MessageComponents({ components, messageId, channelId }: MessageComponentsProps) {
  if (!components || components.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {components.map((row, index) => {
        if (row.type === ComponentType.ActionRow) {
          return (
            <ActionRow
              key={row.custom_id || `row-${index}`}
              component={row}
              channelId={channelId}
              messageId={messageId}
            />
          );
        }
        // If it's not an ActionRow at top level, still try to render it
        return null;
      })}
    </div>
  );
}
