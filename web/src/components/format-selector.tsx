import { useState } from 'react';
import { setConsumerFormats } from '../api-client.js';
import type { ClientFormat, Consumer } from '../api-types.js';

const FORMAT_OPTIONS: Array<{ value: ClientFormat; label: string; title: string }> = [
  { value: 'claude-code', label: 'CC', title: 'Claude Code (.mcp.json)' },
  { value: 'cursor', label: 'Cur', title: 'Cursor (.cursor/mcp.json)' },
  { value: 'vscode', label: 'VS', title: 'VS Code (.vscode/mcp.json)' },
];

interface FormatSelectorProps {
  consumer: Consumer;
  /** Re-fetches the consumer list after a successful toggle so the chips
   * reflect the persisted state (read-after-write), matching the pattern
   * used elsewhere in the UI. */
  onChange: () => void | Promise<void>;
}

/** FMT-3: segmented chips (Claude Code / Cursor / VS Code) reflecting
 * `consumer.clientFormats`; toggling persists via PUT /api/consumers/:id/formats. */
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
              title={option.title}
              aria-pressed={active}
              disabled={pending === option.value}
              onClick={() => void toggle(option.value)}
              className={`cursor-pointer px-2 py-1 font-mono text-xs transition duration-150 disabled:opacity-40 ${
                index > 0 ? 'border-l border-line/15' : ''
              } ${
                active
                  ? 'bg-accent/15 font-semibold text-accent'
                  : 'text-faint hover:bg-raise hover:text-dim'
              }`}
            >
              {option.label}
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
