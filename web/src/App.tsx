import { useCallback, useEffect, useState } from 'react';
import AssignmentMatrix from './components/assignment-matrix.js';
import ConsumersList from './components/consumers-list.js';
import ControlRail, { TAB_ITEMS, type ConsoleTab } from './components/control-rail.js';
import McpForm from './components/mcp-form.js';
import McpServerList from './components/mcp-server-list.js';
import McpStatus from './components/mcp-status.js';
import WriteConfigsButton from './components/write-configs-button.js';
import { deleteMcpServer, listMcpServers } from './api-client.js';
import { ErrorNote } from './components/ui-primitives.js';
import type { McpServer } from './api-types.js';

/** Console shell: desktop control rail + mobile top bar around the four
 * sections (MCP catalog, project ledger, access matrix, ops). Everything is
 * backed by the real `/api` through the typed client -- this is the same
 * view Express serves as the static SPA (src/api/create-app.ts). */
export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<ConsoleTab>('mcp-servers');
  const [servers, setServers] = useState<McpServer[]>([]);
  const [editing, setEditing] = useState<McpServer | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refreshServers = useCallback(async () => {
    try {
      setServers(await listMcpServers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
    }
  }, []);

  useEffect(() => {
    void refreshServers();
  }, [refreshServers]);

  async function handleDelete(id: string): Promise<void> {
    try {
      await deleteMcpServer(id);
      if (editing?.id === id) {
        setEditing(undefined);
      }
      await refreshServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete MCP server');
    }
  }

  return (
    <div className="flex min-h-dvh">
      <ControlRail tab={tab} onTabChange={setTab} />

      <div className="min-w-0 flex-1">
        {/* Mobile top bar (rail is desktop-only). */}
        <header className="sticky top-0 z-20 border-b border-line/10 bg-bg/90 backdrop-blur-sm lg:hidden">
          <div className="flex items-center justify-between px-4 pt-3">
            <p className="font-display text-base font-bold tracking-tight text-ink">
              mcp<span className="text-accent">/</span>manager
            </p>
            <p className="font-mono text-[11px] text-faint">{window.location.host}</p>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 py-2" aria-label="Console sections">
            {TAB_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => setTab(item.id)}
                className={`shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-sm transition duration-150 ${
                  tab === item.id ? 'bg-accent/12 font-semibold text-accent' : 'text-dim hover:bg-raise hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 lg:px-8">
          <ErrorNote message={error} />

          {tab === 'mcp-servers' && (
            <div className="space-y-4">
              <McpForm
                mcp={editing}
                onSaved={() => {
                  setEditing(undefined);
                  void refreshServers();
                }}
                onCancel={editing ? () => setEditing(undefined) : undefined}
              />
              <McpServerList servers={servers} onEdit={setEditing} onDelete={handleDelete} />
            </div>
          )}

          {tab === 'projects' && <ConsumersList />}
          {tab === 'assignments' && <AssignmentMatrix />}
          {tab === 'actions' && (
            <div className="space-y-4">
              <WriteConfigsButton />
              <McpStatus />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
