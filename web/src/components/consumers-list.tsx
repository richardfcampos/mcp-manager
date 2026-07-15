import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  discoverConsumers,
  getAssignmentMatrix,
  listConsumers,
  listMcpServers,
  registerProjectConsumer,
} from '../api-client.js';
import type { Consumer, McpServer } from '../api-types.js';
import { groupConsumers, matchesQuery } from './project-category-utils.js';
import ProjectRow from './project-row.js';
import { EmptyState, ErrorNote, SkeletonRows, cls } from './ui-primitives.js';

/** Project ledger (PRJ-01/02/03): searchable, grouped by workspace category,
 * with rescan, manual registration, per-project format chips, gateway-URL
 * copy and scoped config writes. */
export default function ConsumersList(): React.JSX.Element {
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [assignedByConsumer, setAssignedByConsumer] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newPath, setNewPath] = useState('');
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [consumersList, matrix, serversList] = await Promise.all([
        listConsumers(),
        getAssignmentMatrix(),
        listMcpServers(),
      ]);
      setConsumers(consumersList);
      setServers(serversList);
      setAssignedByConsumer(
        Object.fromEntries(matrix.consumers.map((row) => [row.consumerId, row.allowedMcpIds])),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRescan(): Promise<void> {
    setRescanning(true);
    setError(null);
    try {
      await discoverConsumers();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescan failed');
    } finally {
      setRescanning(false);
    }
  }

  async function handleRegister(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await registerProjectConsumer(newPath, newName || undefined);
      setNewPath('');
      setNewName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  const groups = useMemo(
    () => groupConsumers(consumers.filter((consumer) => matchesQuery(consumer, query))),
    [consumers, query],
  );
  const visibleCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-line/10 bg-surface">
        <header className="flex flex-wrap items-center gap-3 border-b border-line/10 px-4 py-3">
          <h3 className="font-display text-base font-semibold tracking-tight text-ink">Projects</h3>
          <span className="font-mono text-xs text-faint">
            {visibleCount}/{consumers.length}
          </span>
          <div className="ml-auto flex flex-nowrap items-center gap-2">
            {/* Width on the wrapper: cls.input carries w-full and a second
             * width utility on the same element resolves by CSS order. */}
            <div className="w-44 sm:w-56">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by name or path…"
                aria-label="Filter projects"
                className={cls.input}
              />
            </div>
            <button type="button" onClick={() => void handleRescan()} disabled={rescanning} className={cls.btnGhost}>
              <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 ${rescanning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5V4.5h-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {rescanning ? 'Scanning…' : 'Rescan'}
            </button>
          </div>
        </header>

        <div className="px-4 pt-3">
          <ErrorNote message={error} />
        </div>

        {loading ? (
          <div className="p-4">
            <SkeletonRows rows={6} />
          </div>
        ) : visibleCount === 0 ? (
          <div className="p-4">
            <EmptyState
              title={query ? 'No project matches this filter' : 'No projects yet'}
              hint={
                query
                  ? 'Adjust the filter, or rescan the workspace to pick up new folders.'
                  : 'Rescan the mounted workspace, or register a path manually below.'
              }
            />
          </div>
        ) : (
          <div>
            {groups.map((group) => {
              const isCollapsed = collapsed[group.category] ?? false;
              return (
                <div key={group.category}>
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((c) => ({ ...c, [group.category]: !isCollapsed }))}
                    className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 border-y border-line/10 bg-raise/95 px-4 py-1.5 text-left backdrop-blur-sm transition duration-150 hover:bg-raise"
                  >
                    <svg viewBox="0 0 12 12" className={`h-2.5 w-2.5 text-faint transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`} fill="currentColor" aria-hidden>
                      <path d="M2 4l4 4 4-4z" />
                    </svg>
                    <span className="font-display text-xs font-semibold uppercase tracking-widest text-dim">
                      {group.category}
                    </span>
                    <span className="font-mono text-[11px] text-faint">{group.items.length}</span>
                  </button>
                  {!isCollapsed && (
                    <ul className="divide-y divide-line/5">
                      {group.items.map((consumer) => (
                        <ProjectRow
                          key={consumer.id}
                          consumer={consumer}
                          servers={servers}
                          assignedMcpIds={assignedByConsumer[consumer.id] ?? []}
                          onChanged={refresh}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line/10 bg-surface p-4">
        <h4 className="font-display text-sm font-semibold text-ink">Register a project manually</h4>
        <p className="mt-0.5 text-xs text-faint">For folders outside the auto-discovered workspace levels.</p>
        <form onSubmit={(event) => void handleRegister(event)} className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="register-path" className={cls.label}>
              Absolute path
            </label>
            <input
              id="register-path"
              className={`${cls.input} mt-1 font-mono text-sm`}
              placeholder="/absolute/path/to/project"
              value={newPath}
              onChange={(event) => setNewPath(event.target.value)}
              required
            />
          </div>
          <div className="w-44">
            <label htmlFor="register-name" className={cls.label}>
              Name <span className="normal-case">(optional)</span>
            </label>
            <input
              id="register-name"
              className={`${cls.input} mt-1 text-sm`}
              placeholder="defaults to folder"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <button type="submit" className={cls.btnPrimary}>
            Register
          </button>
        </form>
      </section>
    </div>
  );
}
