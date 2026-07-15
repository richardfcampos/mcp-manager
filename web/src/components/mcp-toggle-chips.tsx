import { useState } from 'react';
import { assignMcp, unassignMcp } from '../api-client.js';
import type { McpServer } from '../api-types.js';
import { cls } from './ui-primitives.js';

const FILTER_THRESHOLD = 8;

interface McpToggleChipsProps {
  consumerId: string;
  servers: McpServer[];
  assignedMcpIds: string[];
  /** Called after a successful toggle so the parent re-fetches counts/sets. */
  onChanged: () => void | Promise<void>;
}

/** Project-centric assignment editor: one chip per registered MCP, accent
 * when assigned to this consumer; clicking toggles the assignment (ACC-01).
 * Scales vertically where the matrix's columns don't -- with many MCPs a
 * filter box appears. */
export default function McpToggleChips({
  consumerId,
  servers,
  assignedMcpIds,
  onChanged,
}: McpToggleChipsProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assigned = new Set(assignedMcpIds);

  async function toggle(server: McpServer): Promise<void> {
    setError(null);
    setBusyId(server.id);
    try {
      if (assigned.has(server.id)) await unassignMcp(consumerId, server.id);
      else await assignMcp(consumerId, server.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
    } finally {
      setBusyId(null);
    }
  }

  const visible = servers.filter(
    (server) => !query || server.slug.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      {servers.length > FILTER_THRESHOLD && (
        <div className="w-56">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter MCPs…"
            aria-label="Filter MCPs"
            className={`${cls.input} text-sm`}
          />
        </div>
      )}

      {servers.length === 0 ? (
        <p className="text-xs text-faint">No MCP servers registered yet — add one in the MCP servers tab.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="MCP access for this project">
          {visible.map((server) => {
            const active = assigned.has(server.id);
            return (
              <button
                key={server.id}
                type="button"
                aria-pressed={active}
                disabled={busyId === server.id}
                onClick={() => void toggle(server)}
                title={active ? `Revoke ${server.slug} from this project` : `Grant ${server.slug} to this project`}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs transition duration-150 active:scale-[0.98] disabled:opacity-50 ${
                  active
                    ? 'border-accent/40 bg-accent/12 font-semibold text-accent'
                    : 'border-line/15 text-dim hover:bg-raise hover:text-ink'
                }`}
              >
                <span aria-hidden>{active ? '✓' : '+'}</span>
                {server.slug}
              </button>
            );
          })}
          {visible.length === 0 && <p className="text-xs text-faint">No MCP matches this filter.</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-err">
          {error}
        </p>
      )}
    </div>
  );
}
