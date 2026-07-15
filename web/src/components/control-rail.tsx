import { useEffect, useState } from 'react';
import { getAssignmentMatrix, listConsumers, listMcpServers } from '../api-client.js';
import { StatusDot } from './ui-primitives.js';

export type ConsoleTab = 'mcp-servers' | 'projects' | 'assignments' | 'actions';

const STATS_POLL_MS = 15000;

interface RailCounts {
  servers: number;
  projects: number;
  assignments: number;
}

export const TAB_ITEMS: Array<{ id: ConsoleTab; label: string; icon: React.JSX.Element }> = [
  {
    id: 'mcp-servers',
    label: 'MCP servers',
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <rect x="2" y="2.5" width="12" height="4.5" rx="1" />
        <rect x="2" y="9" width="12" height="4.5" rx="1" />
        <circle cx="4.6" cy="4.75" r="0.4" fill="currentColor" />
        <circle cx="4.6" cy="11.25" r="0.4" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.8h4.5A1.5 1.5 0 0 1 14 6.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
      </svg>
    ),
  },
  {
    id: 'assignments',
    label: 'Access matrix',
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M2.5 5.5h11M2.5 10.5h11M5.5 2.5v11M10.5 2.5v11" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'actions',
    label: 'Ops & status',
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M1.5 8h3l1.5-4 3 8 1.5-4h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

interface ControlRailProps {
  tab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

/** Desktop control rail: wordmark, section nav and live gateway counters
 * (light 15s poll). The pulsing dot is honest -- this UI is served by the
 * same process as the gateway, so "reachable" means the gateway is up. */
export default function ControlRail({ tab, onTabChange }: ControlRailProps): React.JSX.Element {
  const [counts, setCounts] = useState<RailCounts | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const [servers, consumers, matrix] = await Promise.all([
          listMcpServers(),
          listConsumers(),
          getAssignmentMatrix(),
        ]);
        if (!cancelled) {
          setCounts({
            servers: servers.length,
            projects: consumers.length,
            assignments: matrix.consumers.reduce((sum, row) => sum + row.allowedMcpIds.length, 0),
          });
        }
      } catch {
        if (!cancelled) setCounts(null);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line/10 bg-surface/60 lg:flex">
      <div className="px-5 pb-5 pt-6">
        <p className="font-display text-lg font-bold leading-none tracking-tight text-ink">
          mcp<span className="text-accent">/</span>manager
        </p>
        <p className="mt-1 font-mono text-[11px] text-faint">gateway console</p>
      </div>

      <nav className="flex flex-col gap-0.5 px-3" aria-label="Console sections">
        {TAB_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => onTabChange(item.id)}
            className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition duration-150 active:scale-[0.99] ${
              tab === item.id
                ? 'bg-accent/12 font-semibold text-accent'
                : 'text-dim hover:bg-raise hover:text-ink'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto space-y-3 border-t border-line/10 px-5 py-4">
        {counts && (
          <dl className="grid grid-cols-3 gap-1 font-mono text-[11px] text-faint">
            <div>
              <dt className="sr-only">MCP servers</dt>
              <dd className="text-base font-semibold tabular-nums text-ink">{counts.servers}</dd>
              <dd>mcps</dd>
            </div>
            <div>
              <dt className="sr-only">Projects</dt>
              <dd className="text-base font-semibold tabular-nums text-ink">{counts.projects}</dd>
              <dd>proj</dd>
            </div>
            <div>
              <dt className="sr-only">Assignments</dt>
              <dd className="text-base font-semibold tabular-nums text-ink">{counts.assignments}</dd>
              <dd>links</dd>
            </div>
          </dl>
        )}
        <p className="flex items-center gap-2 font-mono text-[11px] text-faint">
          <StatusDot tone={counts ? 'ok' : 'err'} pulse={Boolean(counts)} />
          <span className="truncate">{window.location.host}</span>
        </p>
      </div>
    </aside>
  );
}
