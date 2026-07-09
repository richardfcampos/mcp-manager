import { useState } from 'react';
import { setConsumerFormats } from '../api-client.js';
import type { ClientFormat, Consumer } from '../api-types.js';

const FORMAT_OPTIONS: Array<{ value: ClientFormat; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
];

interface FormatSelectorProps {
  consumer: Consumer;
  /** Re-fetches the consumer list after a successful toggle so the
   * checkboxes reflect the persisted state (not just optimistic local
   * state), matching the read-after-write pattern used elsewhere in the UI. */
  onChange: () => void | Promise<void>;
}

/** FMT-3: per-project checkboxes (Claude Code / Cursor / VS Code) reflecting
 * `consumer.clientFormats`; toggling one persists the new set via
 * `PUT /api/consumers/:id/formats` and refreshes the parent list. */
export default function FormatSelector({ consumer, onChange }: FormatSelectorProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ClientFormat | null>(null);

  async function toggle(format: ClientFormat, checked: boolean): Promise<void> {
    setError(null);
    setPending(format);
    const nextFormats = checked
      ? [...consumer.clientFormats, format]
      : consumer.clientFormats.filter((existing) => existing !== format);
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
    <div>
      <div className="flex flex-wrap gap-2">
        {FORMAT_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={consumer.clientFormats.includes(option.value)}
              disabled={pending === option.value}
              onChange={(event) => void toggle(option.value, event.target.checked)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
