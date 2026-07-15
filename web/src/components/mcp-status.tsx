import { useEffect, useState } from 'react';
import { getMcpStatus, testMcp } from '../api-client.js';
import type { McpStatusEntry, UpstreamStatus } from '../api-types.js';
import { EmptyState, ErrorNote, SectionCard, StatusDot } from './ui-primitives.js';

const POLL_INTERVAL_MS = 5000;

const STATUS_META: Record<UpstreamStatus, { tone: 'ok' | 'warn' | 'err' | 'idle'; chip: string; pulse: boolean }> = {
  running: { tone: 'ok', chip: 'text-ok border-ok/30', pulse: true },
  starting: { tone: 'warn', chip: 'text-warn border-warn/30', pulse: true },
  error: { tone: 'err', chip: 'text-err border-err/30', pulse: false },
  stopped: { tone: 'idle', chip: 'text-faint border-line/15', pulse: false },
};

/** Polls GET /api/actions/status: every registered MCP's live upstream
 * health, including the last failure reason for 'error'. The `test` action
 * forces the lazy upstream to connect right now (POST /api/actions/test-mcp)
 * so working/broken is a click, not a wait for some client's first call. */
export default function McpStatus(): React.JSX.Element {
  const [statuses, setStatuses] = useState<McpStatusEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testNotes, setTestNotes] = useState<Record<string, string>>({});

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

  async function runTest(mcpId: string): Promise<void> {
    setTestingId(mcpId);
    setTestNotes((notes) => ({ ...notes, [mcpId]: '' }));
    try {
      const result = await testMcp(mcpId);
      setTestNotes((notes) => ({
        ...notes,
        [mcpId]: result.status === 'running' ? 'connected — upstream is healthy' : (result.error ?? 'failed'),
      }));
    } catch (err) {
      setTestNotes((notes) => ({
        ...notes,
        [mcpId]: err instanceof Error ? err.message : 'test failed',
      }));
    } finally {
      setTestingId(null);
    }
  }

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
      <p className="-mt-1 text-xs text-faint">
        Upstreams are lazy: <span className="font-mono">stopped</span> just means idle — the process starts on the
        first tool call (or use <span className="font-mono">test</span> to connect it now). The first boot of a new
        MCP downloads its runtime and can take ~1 min.
      </p>
      <div className="mt-3">
        <ErrorNote message={error} />
      </div>
      {statuses.length === 0 ? (
        <EmptyState title="No MCP servers registered" hint="Status appears here once the first MCP exists." />
      ) : (
        <ul className="-mx-4 -mb-4 mt-2 divide-y divide-line/5">
          {statuses.map((entry) => {
            const meta = STATUS_META[entry.status];
            const note = testNotes[entry.mcpId];
            const failureReason = entry.status === 'error' ? entry.error : undefined;
            return (
              <li key={entry.mcpId} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <StatusDot tone={meta.tone} pulse={meta.pulse} />
                  <span className="font-mono text-sm text-ink">{entry.slug}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runTest(entry.mcpId)}
                      disabled={testingId === entry.mcpId}
                      title="Connect this upstream now and report the outcome"
                      className="cursor-pointer rounded-md border border-line/15 px-2 py-0.5 font-mono text-xs text-dim transition duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
                    >
                      {testingId === entry.mcpId ? 'testing…' : 'test'}
                    </button>
                    <span className={`rounded-sm border px-2 py-0.5 font-mono text-xs ${meta.chip}`}>
                      {entry.status}
                    </span>
                  </span>
                </div>
                {(failureReason || note) && (
                  <p
                    className={`mt-1.5 pl-5 font-mono text-xs ${
                      note?.startsWith('connected') ? 'text-ok' : 'text-err/90'
                    }`}
                  >
                    {note || failureReason}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
