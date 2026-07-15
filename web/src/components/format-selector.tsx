import { useState } from 'react';
import { setConsumerFormats } from '../api-client.js';
import type { ClientFormat, Consumer } from '../api-types.js';
import { ClaudeIcon, CodexIcon, CursorIcon, VSCodeIcon } from './client-icons.js';

const FORMAT_OPTIONS: Array<{
  value: ClientFormat;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
}> = [
  { value: 'claude-code', label: 'Claude Code (.mcp.json)', Icon: ClaudeIcon },
  { value: 'cursor', label: 'Cursor (.cursor/mcp.json)', Icon: CursorIcon },
  { value: 'vscode', label: 'VS Code (.vscode/mcp.json)', Icon: VSCodeIcon },
  { value: 'codex', label: 'Codex (.codex/config.toml)', Icon: CodexIcon },
];

interface FormatSelectorProps {
  consumer: Consumer;
  /** Re-fetches the consumer list after a successful toggle so the icons
   * reflect the persisted state (read-after-write). */
  onChange: () => void | Promise<void>;
}

/** FMT-3: a row of client icons (Claude Code / Cursor / VS Code / Codex)
 * reflecting `consumer.clientFormats`; an active client is filled with the
 * accent, inactive ones dimmed. Toggling persists via PUT
 * /api/consumers/:id/formats. Each control carries the full client name as a
 * title + aria-label so the icon-only picker stays accessible. */
export default function FormatSelector({ consumer, onChange }: FormatSelectorProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ClientFormat | null>(null);

  async function toggle(format: ClientFormat): Promise<void> {
    const active = consumer.clientFormats.includes(format);
    setError(null);
    setPending(format);
    const nextFormats = active
      ? consumer.clientFormats.filter((existing) => existing !== format)
      : [...consumer.clientFormats, format];
    try {
      await setConsumerFormats(consumer.id, nextFormats);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update formats');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="inline-flex overflow-hidden rounded-md border border-line/15" role="group" aria-label="Client config formats">
        {FORMAT_OPTIONS.map((option, index) => {
          const active = consumer.clientFormats.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              title={active ? `${option.label} — on` : `${option.label} — off`}
              aria-label={option.label}
              aria-pressed={active}
              disabled={pending === option.value}
              onClick={() => void toggle(option.value)}
              className={`flex cursor-pointer items-center justify-center px-2.5 py-1.5 transition duration-150 disabled:opacity-40 ${
                index > 0 ? 'border-l border-line/15' : ''
              } ${
                active
                  ? 'bg-accent/15 text-accent'
                  : 'text-faint opacity-70 hover:bg-raise hover:opacity-100'
              }`}
            >
              <option.Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs text-err">
          {error}
        </p>
      )}
    </div>
  );
}
