import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { assignMcp, getAssignmentMatrix, listConsumers, listMcpServers, unassignMcp } from '../api-client.js';
import type { Consumer, McpServer } from '../api-types.js';
import { groupConsumers, matchesQuery, shortNameOf } from './project-category-utils.js';
import { EmptyState, ErrorNote, SkeletonRows, cls } from './ui-primitives.js';

/** ACC-01: consumers × MCP grid. Sticky header + sticky project column so
 * the matrix stays navigable at 50+ projects; searchable; grouped by
 * category; each toggle persists immediately (optimistic, reconciled on
 * failure). */
export default function AssignmentMatrix(): React.JSX.Element {
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [allowed, setAllowed] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [consumersList, serversList, matrix] = await Promise.all([
        listConsumers(),
        listMcpServers(),
        getAssignmentMatrix(),
      ]);
      setConsumers(consumersList);
      setServers(serversList);
      const nextAllowed: Record<string, Set<string>> = {};
      for (const row of matrix.consumers) {
        nextAllowed[row.consumerId] = new Set(row.allowedMcpIds);
      }
      setAllowed(nextAllowed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignment matrix');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(consumerId: string, mcpServerId: string, checked: boolean): Promise<void> {
    setError(null);
    setAllowed((current) => {
      const next = { ...current };
      const set = new Set(next[consumerId] ?? []);
      if (checked) set.add(mcpServerId);
      else set.delete(mcpServerId);
      next[consumerId] = set;
      return next;
    });
    try {
      if (checked) await assignMcp(consumerId, mcpServerId);
      else await unassignMcp(consumerId, mcpServerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
      await refresh();
    }
  }

  const groups = useMemo(
    () => groupConsumers(consumers.filter((consumer) => matchesQuery(consumer, query))),
    [consumers, query],
  );
  const assignedPerServer = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const set of Object.values(allowed)) {
      for (const id of set) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [allowed]);

  return (
    <section className="overflow-hidden rounded-lg border border-line/10 bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line/10 px-4 py-3">
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">Access matrix</h3>
        <span className="font-mono text-xs text-faint">
          {servers.length} mcp{servers.length === 1 ? '' : 's'} × {consumers.length} projects
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter projects…"
          aria-label="Filter projects in the matrix"
          className={`${cls.input} ml-auto w-56 py-1.5`}
        />
      </header>

      <div className="px-4 pt-3">
        <ErrorNote message={error} />
      </div>

      {loading ? (
        <div className="p-4">
          <SkeletonRows rows={6} />
        </div>
      ) : consumers.length === 0 || servers.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="Nothing to assign yet"
            hint="Register at least one MCP server and one project; the grid lights up from there."
          />
        </div>
      ) : (
        <div className="max-h-[65dvh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 border-b border-line/15 bg-surface px-4 py-2 text-left font-display text-xs font-semibold uppercase tracking-widest text-dim">
                  Project
                </th>
                {servers.map((server) => (
                  <th
                    key={server.id}
                    className="sticky top-0 z-20 border-b border-line/15 bg-surface px-3 py-2 text-center"
                  >
                    <span className="font-mono text-xs font-medium text-ink">{server.slug}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-faint">
                      {assignedPerServer[server.id] ?? 0}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.category}>
                  <tr>
                    <td
                      colSpan={servers.length + 1}
                      className="sticky left-0 border-b border-line/10 bg-raise/80 px-4 py-1 font-display text-[11px] font-semibold uppercase tracking-widest text-dim"
                    >
                      {group.category}
                    </td>
                  </tr>
                  {group.items.map((consumer) => (
                    <tr key={consumer.id} className={`group ${consumer.available ? '' : 'opacity-45'}`}>
                      <td className="sticky left-0 z-10 max-w-64 truncate border-b border-line/5 bg-surface px-4 py-1.5 font-mono text-xs text-ink transition duration-150 group-hover:bg-raise/60" title={consumer.path}>
                        {shortNameOf(consumer)}
                      </td>
                      {servers.map((server) => {
                        const checked = allowed[consumer.id]?.has(server.id) ?? false;
                        return (
                          <td key={server.id} className="border-b border-line/5 px-3 py-1.5 text-center transition duration-150 group-hover:bg-raise/40">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-[#9be870]"
                              aria-label={`${server.slug} access for ${consumer.name}`}
                              checked={checked}
                              onChange={(event) => void toggle(consumer.id, server.id, event.target.checked)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
