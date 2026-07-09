import { useEffect, useState } from 'react';
import { getMcpStatus } from '../api-client.js';
import type { McpStatusEntry, UpstreamStatus } from '../api-types.js';

const POLL_INTERVAL_MS = 5000;

const STATUS_STYLES: Record<UpstreamStatus, string> = {
  running: 'bg-green-100 text-green-800',
  starting: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
  stopped: 'bg-slate-100 text-slate-600',
};

/** Polls GET /api/actions/status and renders every registered MCP's live
 * upstream health, including error/unavailable state (an MCP the registry
 * has never connected still shows up as 'stopped', never omitted). */
export default function McpStatus(): React.JSX.Element {
  const [statuses, setStatuses] = useState<McpStatusEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const response = await getMcpStatus();
        if (!cancelled) {
          setStatuses(response.statuses);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load status');
        }
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-semibold text-slate-900">MCP status</h3>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {statuses.length === 0 ? (
        <p className="text-sm text-slate-500">No MCP servers registered yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {statuses.map((entry) => (
            <li key={entry.mcpId} className="flex items-center justify-between">
              <span>{entry.slug}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[entry.status]}`}>
                {entry.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
