import { useCallback, useEffect, useState } from 'react';
import { assignMcp, getAssignmentMatrix, listConsumers, listMcpServers, unassignMcp } from '../api-client.js';
import type { Consumer, McpServer } from '../api-types.js';

/** ACC-01: grid of consumers x MCP servers; each checked cell reflects a
 * persisted assignment and toggling it calls assign/unassign immediately,
 * with an optimistic UI update that reconciles from the server on failure. */
export default function AssignmentMatrix(): React.JSX.Element {
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [allowed, setAllowed] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
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
      if (checked) {
        set.add(mcpServerId);
      } else {
        set.delete(mcpServerId);
      }
      next[consumerId] = set;
      return next;
    });

    try {
      if (checked) {
        await assignMcp(consumerId, mcpServerId);
      } else {
        await unassignMcp(consumerId, mcpServerId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
      await refresh();
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading matrix…</p>;
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-semibold text-slate-900">MCP ↔ project assignments</h3>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {consumers.length === 0 || servers.length === 0 ? (
        <p className="text-sm text-slate-500">Register at least one project and one MCP server first.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-1 pr-2">Project</th>
              {servers.map((server) => (
                <th key={server.id} className="px-2 text-center">
                  {server.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {consumers.map((consumer) => (
              <tr key={consumer.id} className="border-t border-slate-100">
                <td className="py-1 pr-2">{consumer.name}</td>
                {servers.map((server) => (
                  <td key={server.id} className="px-2 text-center">
                    <input
                      type="checkbox"
                      checked={allowed[consumer.id]?.has(server.id) ?? false}
                      onChange={(event) => void toggle(consumer.id, server.id, event.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
