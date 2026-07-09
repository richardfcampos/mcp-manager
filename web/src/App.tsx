import { useCallback, useEffect, useState } from 'react';
import AssignmentMatrix from './components/assignment-matrix.js';
import ConsumersList from './components/consumers-list.js';
import McpForm from './components/mcp-form.js';
import McpStatus from './components/mcp-status.js';
import WriteConfigsButton from './components/write-configs-button.js';
import { deleteMcpServer, listMcpServers } from './api-client.js';
import type { McpServer } from './api-types.js';

type Tab = 'mcp-servers' | 'projects' | 'assignments' | 'actions';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'mcp-servers', label: 'MCP Servers' },
  { id: 'projects', label: 'Projects' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'actions', label: 'Actions & Status' },
];

/** Wires the create-form (T48), consumers list (T49), assignment matrix
 * (T50), write-configs button (T51), and status panel (T52) into one
 * navigable SPA -- everything backed by the real `/api` through the typed
 * client (T47). This is the SAME view Express serves as the static SPA
 * (src/api/create-app.ts / src/server.ts). */
export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('mcp-servers');
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
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">MCP Manager</h1>

        <nav className="flex gap-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                tab === item.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {error && <p className="text-sm text-red-600">{error}</p>}

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
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-lg font-semibold text-slate-900">Registered MCP servers</h3>
              {servers.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No MCP servers registered yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {servers.map((server) => (
                    <li key={server.id} className="flex items-center justify-between">
                      <span>
                        {server.name} <span className="text-slate-400">({server.transport})</span>
                      </span>
                      <span className="space-x-2">
                        <button type="button" onClick={() => setEditing(server)} className="text-blue-600">
                          Edit
                        </button>
                        <button type="button" onClick={() => void handleDelete(server.id)} className="text-red-600">
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
      </div>
    </main>
  );
}
