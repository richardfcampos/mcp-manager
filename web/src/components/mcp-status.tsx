import { useEffect, useState } from 'react';
import { getMcpStatus } from '../api-client.js';
import type { McpStatusEntry, UpstreamStatus } from '../api-types.js';
import { EmptyState, ErrorNote, SectionCard, StatusDot } from './ui-primitives.js';

const POLL_INTERVAL_MS = 5000;

const STATUS_META: Record<UpstreamStatus, { tone: 'ok' | 'warn' | 'err' | 'idle'; chip: string; pulse: boolean }> = {
  running: { tone: 'ok', chip: 'text-ok border-ok/30', pulse: true },
  starting: { tone: 'warn', chip: 'text-warn border-warn/30', pulse: true },
  error: { tone: 'err', chip: 'text-err border-err/30', pulse: false },
  stopped: { tone: 'idle', chip: 'text-faint border-line/15', pulse: false },
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

  const runningCount = statuses.filter((entry) => entry.status === 'running').length;

  return (
    <SectionCard
      title="Upstream status"
      aside={
        <span className="font-mono text-xs text-faint">
          {runningCount}/{statuses.length} running · 5s poll
        </span>
      }
    >
      <ErrorNote message={error} />
      {statuses.length === 0 ? (
        <EmptyState title="No MCP servers registered" hint="Status appears here once the first MCP exists." />
      ) : (
        <ul className="-m-4 mt-0 divide-y divide-line/5">
          {statuses.map((entry) => {
            const meta = STATUS_META[entry.status];
            return (
              <li key={entry.mcpId} className="flex items-center gap-3 px-4 py-2.5">
                <StatusDot tone={meta.tone} pulse={meta.pulse} />
                <span className="font-mono text-sm text-ink">{entry.slug}</span>
                <span className={`ml-auto rounded-sm border px-2 py-0.5 font-mono text-xs ${meta.chip}`}>
                  {entry.status}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
